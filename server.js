const express=require("express"),cors=require("cors"),cron=require("node-cron"),axios=require("axios");require("dotenv").config();
const app=express(),PORT=process.env.PORT||3000;
app.use(cors());app.use(express.json());

// Supabase 設定（永久資料庫，不會因重啟消失）
const SUPA_URL=process.env.SUPABASE_URL||"https://dipfeatcxmjavrgzggva.supabase.co";
const SUPA_KEY=process.env.SUPABASE_SERVICE_KEY||"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRpcGZlYXRjeG1qYXZyZ3pnZ3ZhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjA2MDQwOSwiZXhwIjoyMDkxNjM2NDA5fQ.ul5sFX5qpQwV5cNjCTSJQ53aL4Xso0bVhcNsDMAIygc";
const SUPA_HEADERS={"Content-Type":"application/json","apikey":SUPA_KEY,"Authorization":"Bearer "+SUPA_KEY,"Prefer":"return=representation"};

async function dbGet(table,query=""){const r=await axios.get(SUPA_URL+"/rest/v1/"+table+query,{headers:SUPA_HEADERS});return r.data}
async function dbPost(table,body){const r=await axios.post(SUPA_URL+"/rest/v1/"+table,body,{headers:SUPA_HEADERS});return r.data}
async function dbPatch(table,query,body){const r=await axios.patch(SUPA_URL+"/rest/v1/"+table+query,body,{headers:{...SUPA_HEADERS,"Prefer":"return=minimal"}});return r.status}
async function dbDelete(table,query){const r=await axios.delete(SUPA_URL+"/rest/v1/"+table+query,{headers:SUPA_HEADERS});return r.status}

const LINE_CHANNEL_ID=process.env.LINE_CHANNEL_ID;
const LINE_CHANNEL_SECRET=process.env.LINE_CHANNEL_SECRET;
const LINE_API="https://api.line.me/v2/bot/message/push";
const ADMIN_KEY=process.env.ADMIN_KEY||"kida-admin-2024";

console.log("🚀 KIDA 可菱水提醒系統 - Supabase 模式啟動");

app.get("/",(req,res)=>res.json({status:"ok",message:"KIDA 可菱水提醒系統運作中 💧",db:"Supabase (永久儲存)"}));

// 濾心提醒 - 設定
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

// 查詢個人提醒
app.get("/api/reminder/:userId",async(req,res)=>{
  try{const r=await dbGet("reminders","?userId=eq."+req.params.userId);res.json(r[0]||{})}catch(e){res.status(500).json({error:"server error"})}
});

// 產品保固登錄
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

// Admin API
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

app.get("/api/admin/stats",async(req,res)=>{
  if(!checkAdmin(req,res))return;
  try{
    const reminders=await dbGet("reminders","?select=count");
    const regs=await dbGet("registrations","?select=count");
    res.json({totalReminders:reminders.length,totalRegistrations:regs.length});
  }catch(e){res.status(500).json({error:e.message})}
});

// LINE 推播
async function getLineToken(){const r=await axios.post("https://api.line.me/oauth2/v3/token",`grant_type=client_credentials&client_id=${LINE_CHANNEL_ID}&client_secret=${LINE_CHANNEL_SECRET}`,{headers:{"Content-Type":"application/x-www-form-urlencoded"}});return r.data.access_token}

async function sendMsg(userId,productName,type){
  try{
    const token=await getLineToken();
    let text;
    if(type==="3days")text=`⏰ 【三菱可菱水 濾心更換提醒】\n\n濾心型號：${productName}\n到期日還有 3 天！\n\n請提前準備好新濾心，確保飲水健康 💧\n\n購買濾心：https://www.kida.tw/`;
    else if(type==="today")text=`🚨 【今天請更換濾心！】\n\n濾心型號：${productName}\n\n今天是您的濾心到期日，請立即換上新濾心！\n換完後請重新設定下次提醒 💧\n\n購買濾心：https://www.kida.tw/`;
    else text=`⚠️ 您的【${productName}】濾心已逾期，請盡快更換！\n換完後記得重新設定提醒。\n\n📞 客服：02-2756-5899`;
    await axios.post(LINE_API,{to:userId,messages:[{type:"text",text}]},{headers:{"Content-Type":"application/json","Authorization":"Bearer "+token}});
    console.log("✅ 推播成功:",userId.substring(0,10));
  }catch(e){console.error("推播失敗",e.response?.data||e.message)}
}

function daysDiff(d){const t=new Date,g=new Date(d);t.setHours(0,0,0,0);g.setHours(0,0,0,0);return Math.round((g-t)/86400000)}

// 每天 09:00 濾心提醒
cron.schedule("0 9 * * *",async()=>{
  console.log("⏰ 開始執行濾心提醒...");
  try{
    const rows=await dbGet("reminders","?notified=eq.0");
    for(const r of rows){
      const d=daysDiff(r.nextDate);
      const name=r.productName||"可菱水濾心";
      if(d===3)await sendMsg(r.userId,name,"3days");
      if(d===0){await sendMsg(r.userId,name,"today");await dbPatch("reminders","?userId=eq."+r.userId,{notified:1})}
      if(d===-1){await sendMsg(r.userId,name,"overdue");await dbPatch("reminders","?userId=eq."+r.userId,{notified:1})}
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
          await axios.post(LINE_API,{to:r.userId,messages:[{type:"text",text:`📋 【保固到期提醒】\n\n您的【${r.productName}】\n保固到期日：${r.warrantyEnd}\n還有 ${d} 天到期。\n\n如需諮詢請聯繫客服：\n📞 02-2756-5899`}]},{headers:{"Content-Type":"application/json","Authorization":"Bearer "+token}});
        }catch(e){console.error("保固提醒失敗",e.response?.data||e.message)}
      }
    }
  }catch(e){console.error("保固提醒錯誤",e.message)}
},{timezone:"Asia/Taipei"});

app.listen(PORT,()=>console.log(`🚀 伺服器啟動 port ${PORT} - Supabase 永久儲存模式`));
