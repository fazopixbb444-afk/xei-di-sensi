const express = require("express");
const admin = require("firebase-admin");
const { v4: uuidv4 } = require("uuid");
const rateLimit = require("express-rate-limit");

const app = express();
app.use(express.json());

/* ================= FIREBASE ================= */

const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

/* ================= CONFIG ================= */

const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "123456";
const PORT = process.env.PORT || 3000;

/* ================= RATE LIMIT ================= */

app.use("/login", rateLimit({ windowMs: 60000, max: 10 }));

/* ================= LOGIN KEY ================= */

app.post("/login", async (req, res) => {
  const { key, deviceId } = req.body;

  const keyRef = db.collection("keys").doc(key);
  const keyDoc = await keyRef.get();

  if (!keyDoc.exists) return res.status(401).send("Key inválida");

  const data = keyDoc.data();

  if (data.status !== "ativo")
    return res.status(403).send("Key pausada ou bloqueada");

  if (Date.now() / 1000 > data.expiraEm)
    return res.status(403).send("Key expirada");

  if (!data.deviceId) {
    await keyRef.update({
      deviceId,
      ativacoes: 1,
      ultimoLogin: Date.now()
    });
    return res.send("OK");
  }

  if (data.deviceId !== deviceId)
    return res.status(403).send("Key já usada em outro dispositivo");

  res.send("OK");
});

/* ================= ADMIN LOGIN ================= */

app.post("/admin/login", (req, res) => {
  const { user, pass } = req.body;

  if (user === ADMIN_USER && pass === ADMIN_PASS)
    return res.json({ ok: true });

  res.status(401).json({ ok: false });
});

/* ================= ADMIN FUNÇÕES ================= */

app.post("/admin/gerar", async (req, res) => {
  const { dataExpiracao } = req.body;

  const timestamp = Math.floor(new Date(dataExpiracao).getTime() / 1000);

  const novaKey = uuidv4().split("-")[0].toUpperCase();

  await db.collection("keys").doc(novaKey).set({
    status: "ativo",
    expiraEm: timestamp,
    deviceId: null,
    ativacoes: 0,
    criadoEm: Date.now(),
    ultimoLogin: null
  });

  res.json({ key: novaKey });
});

app.post("/admin/pausar", async (req, res) => {
  await db.collection("keys").doc(req.body.key).update({
    status: "pausado"
  });
  res.send("OK");
});

app.post("/admin/reativar", async (req, res) => {
  await db.collection("keys").doc(req.body.key).update({
    status: "ativo"
  });
  res.send("OK");
});

app.post("/admin/excluir", async (req, res) => {
  await db.collection("keys").doc(req.body.key).delete();
  res.send("OK");
});

app.get("/admin/dashboard", async (req, res) => {
  const snapshot = await db.collection("keys").get();
  const lista = [];
  snapshot.forEach(doc => {
    lista.push({ key: doc.id, ...doc.data() });
  });
  res.json(lista);
});

/* ================= PAINEL WEB ================= */

app.get("/admin", (req, res) => {
res.send(`
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Painel Profissional</title>
<style>
body{background:#0f172a;color:white;font-family:Arial;margin:0}
.container{padding:30px}
.card{background:#1e293b;padding:20px;margin-bottom:20px;border-radius:12px}
input,button{padding:8px;margin:5px;border-radius:6px;border:none}
button{cursor:pointer}
table{width:100%;border-collapse:collapse}
th,td{padding:10px;border-bottom:1px solid #333}
.login{max-width:300px;margin:auto;margin-top:100px}
.hidden{display:none}
</style>
</head>
<body>

<div id="loginBox" class="login card">
<h2>Login Admin</h2>
<input id="user" placeholder="Usuário"><br>
<input id="pass" type="password" placeholder="Senha"><br>
<button onclick="login()">Entrar</button>
<p id="erro"></p>
</div>

<div id="painel" class="container hidden">

<div class="card">
<h3>Criar Nova Key</h3>
<input type="date" id="dataExpiracao">
<button onclick="gerar()">Gerar</button>
<p id="novaKey"></p>
</div>

<div class="card">
<h3>Dashboard</h3>
<button onclick="carregar()">Atualizar</button>
<table>
<thead>
<tr>
<th>Key</th>
<th>Status</th>
<th>Expira</th>
<th>Ações</th>
</tr>
</thead>
<tbody id="tabela"></tbody>
</table>
</div>

</div>

<script>

async function login(){
 const user=document.getElementById("user").value;
 const pass=document.getElementById("pass").value;

 const res=await fetch("/admin/login",{
  method:"POST",
  headers:{"Content-Type":"application/json"},
  body:JSON.stringify({user,pass})
 });

 if(res.ok){
  document.getElementById("loginBox").classList.add("hidden");
  document.getElementById("painel").classList.remove("hidden");
  carregar();
 }else{
  document.getElementById("erro").innerText="Login inválido";
 }
}

async function gerar(){
 const dataExpiracao=document.getElementById("dataExpiracao").value;
 const res=await fetch("/admin/gerar",{
  method:"POST",
  headers:{"Content-Type":"application/json"},
  body:JSON.stringify({dataExpiracao})
 });
 const data=await res.json();
 document.getElementById("novaKey").innerText="Nova Key: "+data.key;
 carregar();
}

async function carregar(){
 const res=await fetch("/admin/dashboard");
 const lista=await res.json();
 const tabela=document.getElementById("tabela");
 tabela.innerHTML="";
 lista.forEach(k=>{
  tabela.innerHTML+=\`
  <tr>
   <td>\${k.key}</td>
   <td>\${k.status}</td>
   <td>\${new Date(k.expiraEm*1000).toLocaleDateString()}</td>
   <td>
    <button onclick="pausar('\${k.key}')">Pausar</button>
    <button onclick="reativar('\${k.key}')">Reativar</button>
    <button onclick="excluir('\${k.key}')">Excluir</button>
   </td>
  </tr>
  \`;
 });
}

async function pausar(key){
 await fetch("/admin/pausar",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({key})});
 carregar();
}

async function reativar(key){
 await fetch("/admin/reativar",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({key})});
 carregar();
}

async function excluir(key){
 await fetch("/admin/excluir",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({key})});
 carregar();
}

</script>
</body>
</html>
`);
});

app.listen(PORT, () => {
  console.log("🔥 Servidor rodando na porta " + PORT);
});