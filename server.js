const express=require("express"),cors=require("cors"),cron=require("node-cron"),axios=require("axios");require("dotenv").config();
const app=express(),PORT=process.env.PORT||3000;
app.use(cors());app.use(express.json());

const SUPA_URL=process.env.SUPABASE_URL||"https://dipfeatcxmjavrgzggva.supabase.co";
const SUPA_KEY=process.env.SUPABASE_SERVICE_KEY||"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRpcGZlYXRjeG1qYXZyZ3pnZ3ZhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjA2MDQwOSwiZXhwIjoyMDkxNjM2NDA5fQ.ul5sFX5qpQwV5cNjCTSJQ53aL4Xso0bVhcNsDMAIygc";
const SUPA_HEADERS={"Content-Type":"application/json","apikey":SUPA_KEY,"Authorization":"Bearer "+SUPA_KEY,"Prefer":"return=representation"};

async function dbGet(table,query=""){const r=await axios.get(SUPA_URL+"/rest/v1/"+table+query,{headers:SUPA_HEADERS});return r.data}
async function dbPost(table,body){const r=await axios.post(SUPA_URL+"/rest/v1/"+table,body,{headers:SUPA_HEADERS});return r.data}
async function dbPatch(table,query,body){const r=await axios.patch(SUPA_URL+"/rest/v1/"+table+query,body,{headers:{...SUPA_HEADERS,"Prefer":"return=minimal"}});return r.status}

const LINE_CHANNEL_ID=process.env.LINE_CHANNEL_ID;
const LINE_CHANNEL_SECRET=process.env.LINE_CHANNEL_SECRET;
const LINE_API="https://api.line.me/v2/bot/message/push";
const ADMIN_KEY=process.env.ADMIN_KEY||"kida-admin-2024";

console.log("🚀 KIDA 可菱水提醒系統 - Supabase 模式啟動");

app.get("/",(req,res)=>res.json({status:"ok",message:"KIDA 可菱水提醒系統運作中 💧",db:"Supabase (永久儲存)"}));

app.post("/api/reminder",async(req,res)=>{
  const{userId,nextDate,productDays,productName}=req.body;
  if(!userId||!nextDate||!productDays)return res.status(400).json({error:"missing fields"});
  try{
    const existing=await dbGet("reminders","?userId=eq."+userId);
    if(existing&&existing.length>0){
      await dbPatch("reminders","?userId=eq."+userId,{nextDate,productDays:parseInt(productDays),productName:productName||"",notified:0});
    }else{
      await dbPost("reminders",{userId,nextDate,productDays:parseInt(productDays),productName:productName||"",notified:0});
    }
    res.json({success:true});
  }catch(e){console.error("reminder error",e.response?.data||e.message);res.status(500).json({error:"server error"})}
});

app.get("/api/reminder/:userId",async(req,res)=>{
  try{const r=await dbGet("reminders","?userId=eq."+req.params.userId);res.json(r[0]||{})}catch(e){res.status(500).json({error:"server error"})}
});

app.post("/api/register",async(req,res)=>{
  const{userId,productName,productCode,purchaseDate,purchasePlace}=req.body;
  if(!userId||!productName||!productCode||!purchaseDate||!purchasePlace)return res.status(400).json({error:"missing fields"});
  try{
    const d=new Date(purchaseDate);d.setFullYear(d.getFullYear()+1);
    const warrantyEnd=d.toISOString().split("T")[0];
    await dbPost("registrations",{userId,productName,productCode,purchaseDate,purchasePlace,warrantyEnd});
    res.json({success:true,warrantyEnd});
  }catch(e){console.error("register error",e.response?.data||e.message);res.status(500).json({error:"server error"})}
});

function checkAdmin(req,res){const key=req.headers["x-admin-key"]||req.query.key;if(key!==ADMIN_KEY){res.status(401).json({error:"未授權"});return false}return true}

app.get("/api/admin/reminders",async(req,res)=>{
  if(!checkAdmin(req,res))return;
  try{
    const rows=await dbGet("reminders","?order=nextDate.asc");
    const today=new Date();today.setHours(0,0,0,0);
    res.json(rows.map(r=>{const d=new Date(r.nextDate);d.setHours(0,0,0,0);return{...r,daysLeft:Math.round((d-today)/86400000)}}));
  }catch(e){res.status(500).json({error:e.message})}
});

app.get("/api/admin/registrations",async(req,res)=>{
  if(!checkAdmin(req,res))return;
  try{
    const rows=await dbGet("registrations","?order=createdAt.desc");
    const today=new Date();today.setHours(0,0,0,0);
    res.json(rows.map(r=>{const d=new Date(r.warrantyEnd);d.setHours(0,0,0,0);return{...r,warrantyDaysLeft:Math.round((d-today)/86400000)}}));
  }catch(e){res.status(500).json({error:e.message})}
});

async function getLineToken(){
  const r=await axios.post("https://api.line.me/oauth2/v3/token",
    `grant_type=client_credentials&client_id=${LINE_CHANNEL_ID}&client_secret=${LINE_CHANNEL_SECRET}`,
    {headers:{"Content-Type":"application/x-www-form-urlencoded"}});
  return r.data.access_token;
}

// Flex Message 推播（含購買按鈕）
function buildFlexMsg(productName, type) {
  const configs = {
    "3days": {
      headerColor: "#E67E22",
      emoji: "⏰",
      title: "濾心即將到期提醒",
      body: `您的【${productName}】濾心還有 3 天到期！\n\n請提前準備好新濾心，確保全家飲水安全 💧`,
      urgent: false
    },
    "today": {
      headerColor: "#E74C3C",
      emoji: "🚨",
      title: "今天請更換濾心！",
      body: `您的【${productName}】濾心今天到期\n\n請立即更換，維持最佳過濾效果！\n換完後請重新設定下次提醒 💧`,
      urgent: true
    },
    "overdue": {
      headerColor: "#C0392B",
      emoji: "⚠️",
      title: "濾心已逾期，請盡快更換",
      body: `您的【${productName}】濾心已逾期\n\n長時間不換濾心會影響過濾效果，請盡速更換！`,
      urgent: true
    }
  };
  const c = configs[type] || configs["3days"];

  return {
    type: "flex",
    altText: `${c.emoji} ${c.title} - ${productName}`,
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "horizontal",
        contents: [
          {type:"text", text: c.emoji + " " + c.title, weight:"bold", size:"md", color:"#FFFFFF", flex:1, wrap:true}
        ],
        backgroundColor: c.headerColor,
        paddingAll: "16px"
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          {
            type: "box", layout: "horizontal", spacing: "sm",
            contents: [
              {type:"text", text:"產品型號", size:"sm", color:"#888888", flex:3},
              {type:"text", text: productName, size:"sm", color:"#333333", flex:5, weight:"bold", wrap:true}
            ]
          },
          {type:"separator"},
          {type:"text", text: c.body, wrap:true, size:"sm", color:"#444444", lineSpacing:"6px"},
          {type:"separator"},
          {
            type:"box", layout:"horizontal", spacing:"sm",
            contents:[
              {type:"image", url:"https://www.kida.tw/favicon.ico", size:"xxs", aspectMode:"cover", aspectRatio:"1:1"},
              {type:"text", text:"KIDA 吉達興居家生活", size:"xs", color:"#888888", gravity:"center"}
            ]
          }
        ],
        paddingAll: "16px"
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          {
            type: "button",
            style: "primary",
            color: "#1976D2",
            action: {type:"uri", label:"🛒 立即購買原廠濾心", uri:"https://www.kida.tw/"},
            height: "sm"
          },
          {
            type: "button",
            style: "secondary",
            action: {type:"uri", label:"💧 重新設定濾心提醒", uri:"https://liff.line.me/2009728428-SfuyDoV1?tab=r"},
            height: "sm"
          },
          {
            type: "button",
            style: "secondary",
            action: {type:"uri", label:"💬 聯絡客服", uri:"https://line.me/R/ti/p/@kida888"},
            height: "sm"
          }
        ],
        paddingAll: "12px"
      }
    }
  };
}

async function sendFlexMsg(userId, productName, type) {
  try {
    const token = await getLineToken();
    await axios.post(LINE_API,
      {to: userId, messages: [buildFlexMsg(productName, type)]},
      {headers: {"Content-Type":"application/json","Authorization":"Bearer "+token}}
    );
    console.log("✅ Flex 推播成功:", userId.substring(0,10), type);
  } catch(e) {
    console.error("推播失敗", e.response?.data||e.message);
  }
}

function daysDiff(d){const t=new Date,g=new Date(d);t.setHours(0,0,0,0);g.setHours(0,0,0,0);return Math.round((g-t)/86400000)}

// 每天 09:00 濾心提醒（附購買按鈕）
cron.schedule("0 9 * * *",async()=>{
  console.log("⏰ 開始執行濾心提醒推播...");
  try{
    const rows=await dbGet("reminders","?notified=eq.0");
    for(const r of rows){
      const d=daysDiff(r.nextDate);
      const name=r.productName||"可菱水濾心";
      if(d===3) await sendFlexMsg(r.userId, name, "3days");
      if(d===0){
        await sendFlexMsg(r.userId, name, "today");
        await dbPatch("reminders","?userId=eq."+r.userId,{notified:1});
      }
      if(d===-1){
        await sendFlexMsg(r.userId, name, "overdue");
        await dbPatch("reminders","?userId=eq."+r.userId,{notified:1});
      }
    }
    console.log("✅ 濾心提醒完成，共",rows.length,"筆");
  }catch(e){console.error("提醒失敗",e.message)}
},{timezone:"Asia/Taipei"});

// 每天 09:05 保固提醒
cron.schedule("5 9 * * *",async()=>{
  try{
    const rows=await dbGet("registrations","");
    for(const r of rows){
      const d=daysDiff(r.warrantyEnd);
      if(d===30||d===7){
        try{
          const token=await getLineToken();
          await axios.post(LINE_API,{to:r.userId,messages:[{type:"flex",altText:"📋 保固即將到期提醒",contents:{type:"bubble",header:{type:"box",layout:"vertical",contents:[{type:"text",text:"📋 保固到期提醒",weight:"bold",color:"#FFFFFF"}],backgroundColor:"#2E7D32",paddingAll:"14px"},body:{type:"box",layout:"vertical",spacing:"md",contents:[{type:"box",layout:"horizontal",contents:[{type:"text",text:"產品",size:"sm",color:"#888",flex:2},{type:"text",text:r.productName,size:"sm",weight:"bold",flex:4,wrap:true}]},{type:"box",layout:"horizontal",contents:[{type:"text",text:"到期日",size:"sm",color:"#888",flex:2},{type:"text",text:r.warrantyEnd+"（剩"+d+"天）",size:"sm",weight:"bold",flex:4,color:d<=7?"#E74C3C":"#333"}]}],paddingAll:"16px"},footer:{type:"box",layout:"vertical",spacing:"sm",contents:[{type:"button",style:"primary",color:"#2E7D32",action:{type:"uri",label:"💬 聯絡客服詢問",uri:"https://line.me/R/ti/p/@kida888"},height:"sm"}],paddingAll:"12px"}}}]},{headers:{"Content-Type":"application/json","Authorization":"Bearer "+token}});
        }catch(e){console.error("保固提醒失敗",e.response?.data||e.message)}
      }
    }
  }catch(e){console.error("保固提醒錯誤",e.message)}
},{timezone:"Asia/Taipei"});

app.listen(PORT,()=>console.log(`🚀 伺服器啟動 port ${PORT} - Supabase + Flex Message 版`));
