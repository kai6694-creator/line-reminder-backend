const express=require("express"),cors=require("cors"),cron=require("node-cron"),axios=require("axios");require("dotenv").config();
const app=express(),PORT=process.env.PORT||3000;
app.use(cors());app.use(express.json());
const SUPA_URL=process.env.SUPABASE_URL||"https://dipfeatcxmjavrgzggva.supabase.co";
const SUPA_KEY=process.env.SUPABASE_SERVICE_KEY||"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRpcGZlYXRjeG1qYXZyZ3pnZ3ZhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjA2MDQwOSwiZXhwIjoyMDkxNjM2NDA5fQ.ul5sFX5qpQwV5cNjCTSJQ53aL4Xso0bVhcNsDMAIygc";
const SUPA_H={"Content-Type":"application/json","apikey":SUPA_KEY,"Authorization":"Bearer "+SUPA_KEY,"Prefer":"return=representation"};
async function dbGet(t,q=""){const r=await axios.get(SUPA_URL+"/rest/v1/"+t+q,{headers:SUPA_H});return r.data}
async function dbPost(t,b){const r=await axios.post(SUPA_URL+"/rest/v1/"+t,b,{headers:SUPA_H});return r.data}
async function dbPatch(t,q,b){const r=await axios.patch(SUPA_URL+"/rest/v1/"+t+q,b,{headers:{...SUPA_H,"Prefer":"return=minimal"}});return r.status}
const LINE_CHANNEL_ID=process.env.LINE_CHANNEL_ID;
const LINE_CHANNEL_SECRET=process.env.LINE_CHANNEL_SECRET;
const LINE_API="https://api.line.me/v2/bot/message/push";
const LINE_REPLY="https://api.line.me/v2/bot/message/reply";
const ADMIN_KEY=process.env.ADMIN_KEY||"kida-admin-2024";
const SHOP_URL="https://www.kida.tw/";
const LINE_ID="https://line.me/R/ti/p/@kida888";
console.log("KIDA 可菱水提醒系統啟動（方案A）");
app.get("/",(req,res)=>res.json({status:"ok",message:"KIDA 可菱水提醒系統運作中",planA:true}));
app.post("/api/reminder",async(req,res)=>{
  const{userId,nextDate,productDays,productName}=req.body;
  if(!userId||!nextDate||!productDays)return res.status(400).json({error:"missing fields"});
  try{
    const existing=await dbGet("reminders","?userId=eq."+userId);
    if(existing&&existing.length>0){await dbPatch("reminders","?userId=eq."+userId,{nextDate,productDays:parseInt(productDays),productName:productName||"",notified:0});}
    else{await dbPost("reminders",{userId,nextDate,productDays:parseInt(productDays),productName:productName||"",notified:0});}
    res.json({success:true});
  }catch(e){res.status(500).json({error:"server error"})}
});
app.get("/api/reminder/:userId",async(req,res)=>{
  try{const r=await dbGet("reminders","?userId=eq."+req.params.userId);res.json(r[0]||{});}catch(e){res.status(500).json({error:"server error"})}
});
app.post("/api/register",async(req,res)=>{
  const{userId,productName,productCode,purchaseDate,purchasePlace}=req.body;
  if(!userId||!productName||!productCode||!purchaseDate||!purchasePlace)return res.status(400).json({error:"missing fields"});
  try{
    const d=new Date(purchaseDate);d.setFullYear(d.getFullYear()+1);
    const warrantyEnd=d.toISOString().split("T")[0];
    await dbPost("registrations",{userId,productName,productCode,purchaseDate,purchasePlace,warrantyEnd});
    res.json({success:true,warrantyEnd});
  }catch(e){res.status(500).json({error:"server error"})}
});
function checkAdmin(req,res){const key=req.headers["x-admin-key"]||req.query.key;if(key!==ADMIN_KEY){res.status(401).json({error:"未授權"});return false}return true}
app.get("/api/admin/reminders",async(req,res)=>{if(!checkAdmin(req,res))return;try{const rows=await dbGet("reminders","?order=nextDate.asc");const today=new Date();today.setHours(0,0,0,0);res.json(rows.map(r=>{const d=new Date(r.nextDate);d.setHours(0,0,0,0);return{...r,daysLeft:Math.round((d-today)/86400000)}}));}catch(e){res.status(500).json({error:e.message})}});
app.get("/api/admin/registrations",async(req,res)=>{if(!checkAdmin(req,res))return;try{const rows=await dbGet("registrations","?order=createdAt.desc");const today=new Date();today.setHours(0,0,0,0);res.json(rows.map(r=>{const d=new Date(r.warrantyEnd);d.setHours(0,0,0,0);return{...r,warrantyDaysLeft:Math.round((d-today)/86400000)}}));}catch(e){res.status(500).json({error:e.message})}});
async function getLineToken(){const r=await axios.post("https://api.line.me/oauth2/v3/token",`grant_type=client_credentials&client_id=${LINE_CHANNEL_ID}&client_secret=${LINE_CHANNEL_SECRET}`,{headers:{"Content-Type":"application/x-www-form-urlencoded"}});return r.data.access_token;}
function buildFilterMsg(productName,type,nextDate){const configs={"7days":{color:"#E67E22",emoji:"⏰",title:"濾心即將到期 - 7天後",body:`您的【${productName}】還有 7 天到期！\n\n現在下單，確保新濾心準時到貨`,btn:"立即購買濾心"},"3days":{color:"#E74C3C",emoji:"⚠️",title:"濾心到期提醒 - 僅剩3天！",body:`您的【${productName}】只剩 3 天就到期了！\n\n請盡快購買新濾心，確保飲水安全`,btn:"馬上購買濾心"},"today":{color:"#C0392B",emoji:"🚨",title:"今天請更換濾心！",body:`您的【${productName}】今天到期！\n\n請立即更換新濾心，完成後記得重新設定提醒`,btn:"購買原廠濾心"},"overdue":{color:"#922B21",emoji:"❗",title:"濾心已逾期，請盡快更換",body:`您的【${productName}】已超過更換日期！\n\n逾期使用可能影響水質，請儘快購買更換`,btn:"立即補購濾心"}};const c=configs[type]||configs["3days"];return{type:"flex",altText:`${c.emoji} ${c.title}｜${productName}`,contents:{type:"bubble",size:"mega",header:{type:"box",layout:"vertical",contents:[{type:"text",text:c.emoji+" "+c.title,weight:"bold",size:"md",color:"#FFFFFF",wrap:true}],backgroundColor:c.color,paddingAll:"16px"},body:{type:"box",layout:"vertical",contents:[{type:"text",text:c.body,wrap:true,size:"sm",color:"#333333"},{type:"separator",margin:"lg"},{type:"box",layout:"horizontal",margin:"lg",contents:[{type:"text",text:"濾心型號",size:"xs",color:"#888888",flex:2},{type:"text",text:productName,size:"xs",color:"#333333",flex:4,weight:"bold",wrap:true}]},{type:"box",layout:"horizontal",margin:"sm",contents:[{type:"text",text:"到期日",size:"xs",color:"#888888",flex:2},{type:"text",text:nextDate||"",size:"xs",color:"#333333",flex:4}]}],paddingAll:"16px"},footer:{type:"box",layout:"vertical",spacing:"sm",contents:[{type:"button",style:"primary",color:"#1976D2",action:{type:"uri",label:"🛒 "+c.btn,uri:SHOP_URL},height:"sm"},{type:"button",style:"secondary",action:{type:"uri",label:"⚙️ 重新設定提醒",uri:"https://liff.line.me/2009728428-SfuyDoV1?tab=r"},height:"sm"},{type:"button",style:"secondary",action:{type:"uri",label:"💬 聯絡客服 @kida888",uri:LINE_ID},height:"sm"}],paddingAll:"12px"}}}}
async function sendMsg(userId,productName,type,nextDate){try{const token=await getLineToken();await axios.post(LINE_API,{to:userId,messages:[buildFilterMsg(productName,type,nextDate)]},{headers:{"Content-Type":"application/json","Authorization":"Bearer "+token}});console.log("推播成功 ["+type+"]:"+userId.substring(0,10));return true;}catch(e){console.error("推播失敗 ["+userId.substring(0,10)+"] "+JSON.stringify(e.response?.data||e.message));return false;}}
function daysDiff(d){const t=new Date,g=new Date(d);t.setHours(0,0,0,0);g.setHours(0,0,0,0);return Math.round((g-t)/86400000)}
async function runFilterReminders(){try{const rows=await dbGet("reminders","?notified=eq.0");let sent=0;for(const r of rows){const d=daysDiff(r.nextDate);const name=r.productName||"可菱水濾心";if(d===7){if(await sendMsg(r.userId,name,"7days",r.nextDate))sent++;}if(d===3){if(await sendMsg(r.userId,name,"3days",r.nextDate))sent++;}if(d===0){if(await sendMsg(r.userId,name,"today",r.nextDate)){await dbPatch("reminders","?userId=eq."+r.userId,{notified:1});sent++;}}if(d===-1){if(await sendMsg(r.userId,name,"overdue",r.nextDate)){await dbPatch("reminders","?userId=eq."+r.userId,{notified:1});sent++;}}}console.log("濾心提醒完成 共"+rows.length+"筆 成功"+sent+"則");return{total:rows.length,sent};}catch(e){throw e}}
async function runWarrantyReminders(){try{const rows=await dbGet("registrations","");let sent=0;for(const r of rows){const d=daysDiff(r.warrantyEnd);if(d===30||d===7){try{const token=await getLineToken();await axios.post(LINE_API,{to:r.userId,messages:[{type:"text",text:"📋【保固到期提醒】\n\n您的【"+r.productName+"】保固到期日："+r.warrantyEnd+"（還有 "+d+" 天）\n\n如有任何問題請聯繫我們！\n📞 02-2756-5899"}]},{headers:{"Content-Type":"application/json","Authorization":"Bearer "+token}});sent++;}catch(e){console.error("保固提醒失敗",e.response?.data)}}}return{total:rows.length,sent};}catch(e){throw e}}
cron.schedule("0 9 * * *",async()=>{await runFilterReminders();},{timezone:"Asia/Taipei"});
cron.schedule("5 9 * * *",async()=>{await runWarrantyReminders();},{timezone:"Asia/Taipei"});
app.get("/api/trigger-reminders",async(req,res)=>{if(!checkAdmin(req,res))return;try{const r=await runFilterReminders();res.json({success:true,...r,timestamp:new Date().toISOString()});}catch(e){res.status(500).json({error:e.message})}});
app.get("/api/trigger-warranty",async(req,res)=>{if(!checkAdmin(req,res))return;try{const r=await runWarrantyReminders();res.json({success:true,...r,timestamp:new Date().toISOString()});}catch(e){res.status(500).json({error:e.message})}});
app.get("/api/test-push",async(req,res)=>{if(!checkAdmin(req,res))return;const uid=req.query.userId;if(!uid)return res.status(400).json({error:"需要 ?userId=XXX"});try{const token=await getLineToken();const r=await axios.post(LINE_API,{to:uid,messages:[{type:"text",text:"🔧 KIDA推播測試 - 收到請告訴主人！"}]},{headers:{"Content-Type":"application/json","Authorization":"Bearer "+token}});res.json({success:true,httpStatus:r.status});}catch(e){res.status(500).json({success:false,error:e.response?.data||e.message})}});
app.get("/api/get-followers",async(req,res)=>{if(!checkAdmin(req,res))return;try{const token=await getLineToken();const H={"Authorization":"Bearer "+token};const botR=await axios.get("https://api.line.me/v2/bot/info",{headers:H});const followersR=await axios.get("https://api.line.me/v2/bot/followers/ids",{headers:H});res.json({botInfo:botR.data,followers:followersR.data});}catch(e){res.status(500).json({error:e.response?.data||e.message})}});
// ===== 方案A：Webhook 自動配對正確 userId =====
app.post("/webhook",async(req,res)=>{
  res.sendStatus(200);
  const events=req.body?.events||[];
  for(const ev of events){
    if(!ev.source?.userId)continue;
    const wId=ev.source.userId;
    const eType=ev.type;
    console.log("Webhook event="+eType+" userId="+wId);
    try{
      const existing=await dbGet("reminders","?userId=eq."+wId);
      if(existing&&existing.length>0){
        console.log("userId 已在 reminders，無需更新");
        if(eType==="message"&&ev.replyToken){
          const token=await getLineToken();
          const rem=existing[0];
          const dLeft=daysDiff(rem.nextDate);
          await axios.post(LINE_REPLY,{replyToken:ev.replyToken,messages:[{type:"text",text:"💧 您的濾心提醒已設定！\n\n產品："+rem.productName+"\n到期日："+rem.nextDate+"（還有 "+dLeft+" 天）\n\n屆時會自動通知您！"}]},{headers:{"Content-Type":"application/json","Authorization":"Bearer "+token}}).catch(()=>{});
        }
        continue;
      }
      const oneHrAgo=new Date(Date.now()-60*60*1000).toISOString();
      const recent=await dbGet("reminders","?notified=eq.0&createdAt=gte."+oneHrAgo+"&order=createdAt.desc&limit=1");
      if(recent&&recent.length>0){
        const oldId=recent[0].userId;
        await dbPatch("reminders","?userId=eq."+oldId,{userId:wId});
        console.log("自動配對成功："+oldId.substring(0,10)+"→"+wId.substring(0,10));
        if(eType==="message"&&ev.replyToken){
          const token=await getLineToken();
          const rem=recent[0];
          const dLeft=daysDiff(rem.nextDate);
          await axios.post(LINE_REPLY,{replyToken:ev.replyToken,messages:[{type:"text",text:"✅ 濾心提醒設定完成！\n\n產品："+rem.productName+"\n到期日："+rem.nextDate+"（還有 "+dLeft+" 天）\n\n到期前我們會自動通知您 💧"}]},{headers:{"Content-Type":"application/json","Authorization":"Bearer "+token}}).catch(()=>{});
        }
      }else{
        console.log("此 userId 無對應 reminder："+wId.substring(0,10));
      }
    }catch(e){console.error("Webhook 處理錯誤:",e.message)}
  }
});
app.listen(PORT,()=>console.log("KIDA 伺服器啟動 port "+PORT));
