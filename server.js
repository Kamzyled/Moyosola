

import express from "express";
import { nanoid } from "nanoid";
import rateLimit from "express-rate-limit";

// --------------------------- CONFIG ---------------------------------
const PORT = process.env.PORT || 5000;
const APP_NAME = "Moyosola";
const FOOTER_CREDIT = "Created with love by Kamzy";

// ------------------------ IN-MEMORY STORE ---------------------------
/**
 * games = {
 *   [code]: {
 *     code,
 *     createdAt,
 *     settings: { numQuestions, relation, timerSec, theme },
 *     player1: { name, avatar, answers: [] },
 *     player2: { name, avatar, answers: [] } | null,
 *     questions: [ { id, relation, text } ],
 *     currentIndex: 0,
 *     finished: false,
 *     matches: 0
 *   }
 * }
 */
const games = {};
const leaderboard = []; // {code, players:[p1,p2], score, total, ts}

// ----------------------- QUESTION FACTORY (1000) --------------------
/**
 * We generate 1000 clean, unique, shuffled questions across relations:
 * romantic, friend, family, fun, random.
 * Format: { id, relation, text }
 */
const RELATIONS = ["romantic", "friend", "family", "fun", "random"];
// Core templates with a placeholder for relation names where needed
const BASE_TEMPLATES = [
  "What is your favourite colour?",
  "What is your favourite food?",
  "What is your favourite movie?",
  "What is your favourite song?",
  "Where did we first meet?",
  "What is your happiest memory with {}?",
  "What is one thing that always makes you smile?",
  "If you could travel anywhere with {}, where would you go?",
  "What is your favourite childhood game?",
  "What is your favourite thing to cook?",
  "Do you prefer mornings or nights?",
  "What is a small thing that annoys you?",
  "Which nickname do you like being called by {}?",
  "What is your dream date with {}?",
  "What is one thing you admire most about {}?",
  "What was your first impression of {}?",
  "What is your favourite season?",
  "Dog or cat — which do you prefer?",
  "What is a skill you wish to learn?",
  "What makes you feel loved?",
  "What is your favourite dessert?",
  "Where is your favourite place to relax?",
  "What is a secret hobby you have?",
  "Which movie genre do you love the most?",
  "What is your favourite drink?",
  "How do you take your coffee or tea?",
  "What is your proudest achievement?",
  "What scares you the most?",
  "What outfit do you love to wear to a party?",
  "If you could relive one day, which would it be?",
  "What emoji do you send to {} the most?",
  "What do you love most about weekends?",
  "What do you remember most about school days?",
  "How do you like to celebrate birthdays?",
  "What is a hidden talent you have?",
  "Would you rather fly or be invisible?",
  "What is your favourite ice cream flavour?",
  "What music makes you dance instantly?",
  "What is one thing you want to achieve this year?",
  "What is your go-to joke?",
  "What habit do you want to stop?",
  "What makes you feel safe?",
  "Which app do you open first each day?",
  "What is your comfort food when sad?",
  "Describe your relationship with {} in one word.",
  "What is the best gift you’ve ever received?",
  "What would you cook for {} on a special day?",
  "What is one thing you miss from childhood?",
  "What is your favourite way to say sorry?",
  "What is your karaoke song?",
  "What is a dream job you’d enjoy?",
  "If we had a theme song, what would it be?",
  "What colour reminds you of {}?",
  "What do you love to do on a rainy day?",
  "What small act melts your heart?",
  "What funny habit do you have?",
  "What is your favourite board game?",
  "Beaches or mountains — pickone.",
  "What family tradition do you love?",
  "Which dessert would you share with {}?",
  "What silly fear do you have?",
  "Describe your perfect morning.",
  "How do you spend a free 30 minutes?",
  "What was your first job?",
  "What is your favourite fruit?",
  "Which scent do you love?",
  "Your favourite memory from last year?",
  "What quality do you value most in a friend?",
  "Where is the best place for us to take photos together?",
  "Who is your favourite speaker or podcast?",
  "What is one thing you wish I knew about you?",
  "How do you relax after a hard day?",
  "Your ultimate comfort movie?",
  "How do you say ‘I love you’ without words?",
  "Best surprise you’ve ever had?",
  "Your favourite street food?",
  "Your favourite way to decorate a room?",
  "One habit you find attractive in others?",
  "Your favourite way to spend a holiday?",
  "A memory that makes you laugh every time?",
  "Title of the book about your life?",
  "Your favourite way to learn something new?",
  "One thing you would change in the world?",
  "Favourite sport to watch or play?",
  "Your favourite time of day?"
];

function labelForRelation(rel, fallback = "them") {
  if (rel === "romantic") return "your partner";
  if (rel === "friend") return "your friend";
  if (rel === "family") return "your family";
  return fallback;
}

function buildQuestionText(template, relation) {
  if (template.includes("{}")) {
    return template.replace("{}", labelForRelation(relation));
  }
  return template;
}

function generate1000Questions() {
  const questions = [];
  let id = 1;

  // We’ll mix variations to reach 1000 without duplicates:
  // - cycle relations
  // - cycle templates
  // - add lightweight suffixes occasionally for uniqueness
  for (let i = 0; i < 1000; i++) {
    const rel = RELATIONS[i % RELATIONS.length];
    const tmpl = BASE_TEMPLATES[i % BASE_TEMPLATES.length];
    let text = buildQuestionText(tmpl, rel);

    // light, non-repetitive variants every few indices
    if (i % 7 === 0) text += " (Be honest)";
    else if (i % 11 === 0) text += " (Tell the truth)";
    else if (i % 13 === 0) text += " (Keep it simple)";

    questions.push({ id: id++, relation: rel, text });
  }
  // Shuffle once at startup
  for (let j = questions.length - 1; j > 0; j--) {
    const k = Math.floor(Math.random() * (j + 1));
    [questions[j], questions[k]] = [questions[k], questions[j]];
  }
  return questions;
}

const QUESTIONS_POOL = generate1000Questions();

// -------------------------- HELPERS ---------------------------------
const limiter = rateLimit({
  windowMs: 15 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false
});
function clamp(n, min, max) { return Math.max(min, Math.min(n, max)); }

function pickQuestions(count, relation) {
  const pool = relation && relation !== "random"
    ? QUESTIONS_POOL.filter(q => q.relation === relation || q.relation === "random")
    : QUESTIONS_POOL.slice();

  // simple shuffle copy
  const arr = pool.slice();
  for (let j = arr.length - 1; j > 0; j--) {
    const k = Math.floor(Math.random() * (j + 1));
    [arr[j], arr[k]] = [arr[k], arr[j]];
  }
  return arr.slice(0, count);
}

function computeScore(game) {
  const total = game.settings.numQuestions;
  let matches = 0;
  for (let i = 0; i < total; i++) {
    const a = (game.player1.answers[i] || "").trim().toLowerCase();
    const b = (game.player2?.answers[i] || "").trim().toLowerCase();
    if (a && b && a === b) matches++;
  }
  return { matches, total, percent: Math.round((matches / total) * 100) };
}

// --------------------------- SERVER ---------------------------------
const app = express();
app.use(express.json({ limit: "256kb" }));
app.use(limiter);

// --------- FRONTEND (embedded) ----------
app.get("/", (_req, res) => {
  res.type("html").send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${APP_NAME}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap" rel="stylesheet">
<style>
  :root{
    --bg:#0b0f1a; --card:#111726; --muted:#97a3b6; --text:#e6ecff; --accent:#8a5bff; --accent2:#29e3b1; --danger:#ff6b6b;
    --glass: rgba(255,255,255,0.06);
  }
  *{box-sizing:border-box}
  body{margin:0;font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Ubuntu; background: radial-gradient(1200px 600px at 10% 10%, #1b2140 0%, #0b0f1a 60%), var(--bg); color:var(--text);}
  .wrap{max-width:980px;margin:0 auto;padding:24px}
  header{display:flex;align-items:center;justify-content:space-between;margin-bottom:24px}
  .brand{display:flex;gap:12px;align-items:center}
  .logo{width:40px;height:40px;border-radius:12px;background:linear-gradient(135deg,var(--accent),#4bd3ff);box-shadow:0 8px 24px rgba(138,91,255,.35)}
  h1{margin:0;font-size:26px;letter-spacing:.4px}
  .card{background:var(--glass);border:1px solid #1d2540;border-radius:18px;padding:18px;box-shadow:0 12px 40px rgba(0,0,0,.35);backdrop-filter: blur(8px)}
  .grid{display:grid;grid-template-columns:1fr;gap:16px}
  @media(min-width:800px){.grid{grid-template-columns:1fr 1fr}}
  .btn{padding:14px 18px;border-radius:14px;border:1px solid #2a355a;background:linear-gradient(180deg,#182038,#0e1426);color:var(--text);font-weight:600;cursor:pointer;transition:.2s}
  .btn:hover{transform:translateY(-1px);box-shadow:0 10px 20px rgba(138,91,255,.3)}
  .btn-cta{background:linear-gradient(180deg,var(--accent),#5f3fff);border:0}
  .muted{color:var(--muted);font-size:13px}
  input,select{width:100%;padding:12px 14px;border-radius:12px;border:1px solid #273357;background:#0d1426;color:var(--text)}
  .row{display:flex;gap:12px}
  .row > *{flex:1}
  .title{font-weight:800;font-size:18px;margin:0 0 10px}
  .center{display:flex;align-items:center;justify-content:center}
  .footer{margin-top:28px;text-align:center;color:var(--muted)}
  .badge{display:inline-flex;align-items:center;gap:8px;background:#0f1530;border:1px solid #232d57;border-radius:999px;padding:8px 12px;font-size:12px}
  .progress{height:10px;background:#121a33;border-radius:6px;overflow:hidden;border:1px solid #273357}
  .bar{height:100%;width:0;background:linear-gradient(90deg,var(--accent),var(--accent2));transition:width .25s}
  .q{font-size:20px;line-height:1.5;margin:8px 0 4px}
  .big{font-size:26px}
  .pill{display:inline-block;padding:6px
  10px;border-radius:999px;background:#101735;border:1px solid #253062;color:#b7c3e2;font-size:12px}
  .code{font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace}
  .ok{color:#6ef3c5}.bad{color:#ffb4b4}
  .hidden{display:none}
  .confetti{position:fixed;inset:0;pointer-events:none}
</style>
</head>
<body>
  <canvas id="confetti" class="confetti"></canvas>
  <div class="wrap">
    <header>
      <div class="brand">
        <div class="logo"></div>
        <div>
          <div class="badge">✨ ${APP_NAME}</div>
          <h1>Moyosola — Playful Love & Friendship Game</h1>
          <div class="muted">Connect from anywhere. One creates, the other joins. Guess answers, score points, celebrate.</div>
        </div>
      </div>
      <button class="btn" id="themeBtn">Toggle Theme</button>
    </header>

    <div class="grid">
      <div class="card" id="createCard">
        <p class="title">Create Game (Player 1)</p>
        <div class="row">
          <div>
            <label class="muted">Your Name</label>
            <input id="p1name" placeholder="Player 1"/>
          </div>
          <div>
            <label class="muted">Number of Questions</label>
            <select id="numQ">
              <option>5</option><option>10</option><option>15</option><option>20</option><option>25</option><option>30</option><option>40</option><option>50</option><option>75</option><option>100</option>
            </select>
          </div>
        </div>
        <div class="row">
          <div>
            <label class="muted">Relationship</label>
            <select id="relation">
              <option value="romantic">Wife/Husband (Romantic)</option>
              <option value="friend">Friend</option>
              <option value="family">Family</option>
              <option value="fun">Fun</option>
              <option value="random" selected>Random</option>
            </select>
          </div>
          <div>
            <label class="muted">Timer per Question (seconds, 0 = off)</label>
            <select id="timer">
              <option>0</option><option>10</option><option>15</option><option>20</option><option>30</option><option>45</option><option>60</option>
            </select>
          </div>
        </div>
        <button class="btn btn-cta" id="createBtn">Create Game</button>
        <div id="createResult" class="muted"></div>
      </div>

      <div class="card" id="joinCard">
        <p class="title">Join Game (Player 2)</p>
        <div class="row">
          <div>
            <label class="muted">Your Name</label>
            <input id="p2name" placeholder="Player 2"/>
          </div>
          <div>
            <label class="muted">Game Code</label>
            <input id="joinCode" placeholder="e.g. 4F9KQZ" class="code"/>
          </div>
        </div>
        <button class="btn" id="joinBtn">Join Game</button>
        <div id="joinResult" class="muted"></div>
      </div>
    </div>
    div id="playCard" class="card hidden">
      <div class="row" style="align-items:center;justify-content:space-between">
        <div>
          <div class="pill">Game Code: <span id="gameCode" class="code"></span></div>
          <div class="muted">Share this code with your partner to join from anywhere 🌍</div>
        </div>
        <div id="progressBox" style="min-width:260px">
          <div class="progress"><div id="bar" class="bar"></div></div>
          <div class="muted"><span id="pi">0</span> / <span id="pt">0</span> questions</div>
        </div>
      </div>

      <div id="questionBox" style="margin-top:8px">
        <div class="pill" id="rolePill">Player 1 answering…</div>
        <p id="qText" class="q big"></p>
        <div class="row">
          <input id="answerInput" placeholder="Type your answer"/>
          <button class="btn btn-cta" id="answerBtn">Submit</button>
        </div>
        <div class="muted" id="timerTxt"></div>
      </div>

      <div id="finishBox" class="center hidden" style="flex-direction:column;gap:8px;margin-top:8px">
        <p class="big">Results</p>
        <p id="scoreLine" class="q"></p>
        <div class="row" style="max-width:520px">
          <button class="btn" id="shareBtn">Copy Share Text</button>
          <button class="btn btn-cta" id="rematchBtn">Rematch</button>
        </div>
      </div>
    </div>

    <div class="footer">Moyosola ❤️ • ${FOOTER_CREDIT}</div>
  </div>

<script>
const els = (id)=>document.getElementById(id);
const createBtn = els("createBtn");
const joinBtn = els("joinBtn");
const createResult = els("createResult");
const joinResult = els("joinResult");
const playCard = els("playCard");
const qText = els("qText");
const rolePill = els("rolePill");
const bar = els("bar");
const pi = els("pi");
const pt = els("pt");
const timerTxt = els("timerTxt");
const gameCodeSpan = els("gameCode");
const answerInput = els("answerInput");
const answerBtn = els("answerBtn");
const finishBox = els("finishBox");
const scoreLine = els("scoreLine");
const shareBtn = els("shareBtn");
const rematchBtn = els("rematchBtn");

let GAME = null; // {code, you: 'player1'|'player2'}
let TIMER = null;

function setThemeToggle(){
  const btn = document.getElementById('themeBtn');
  let light = false;
  btn.onclick = ()=>{
    light = !light;
    document.body.style.background = light
      ? "linear-gradient(120deg,#f7f7ff,#e5ecff)"
      : "";
    document.body.style.color = light ? "#111" : "";
  };
}
setThemeToggle();

async function api(path, method="GET", body=null){
  const opt = { method, headers: { "Content-Type":"application/json" } };
  if (body) opt.body = JSON.stringify(body);
  const r = await fetch(path, opt);
  if (!r.ok) throw new Error((await r.json()).error || "Error");
  return r.json();
}

createBtn.onclick = async ()=>{
  try{
    const playerName = document.getElementById("p1name").value || "Player 1";
    const numQuestions = parseInt(document.getElementById("numQ").value,10);
    const relation = document.getElementById("relation").value;
    const timerSec = parseInt(document.getElementById("timer").value,10);
    const res = await api("/api/create","POST",{ playerName, numQuestions, relation, timerSec });
    createResult.textContent = "Game created ✔ Share code: " + res.code;
    GAME = { code: res.code, you: "player1" };
    startPlay();
  }catch(e){ createResult.textContent = e.message; }
};

joinBtn.onclick = async ()=>{
  try{
    const playerName = document.getElementById("p2name").value || "Player 2";
    const code = (document.getElementById("joinCode").value || "").trim();
    const res = await api("/api/join","POST",{ code, playerName });
    joinResult.textContent = "Joined ✔";
    GAME = { code, you: "player2" };
    startPlay();
  }catch(e){ joinResult.textContent = e.message; }
};

function confetti(){
  // tiny confetti using canvas
  const canvas = document.getElementById("confetti");
  const ctx = canvas.getContext("2d");
  let W, H, pieces=[];
  function resize(){ W = canvas.width = innerWidth; H = canvas.height = innerHeight; }
  function spawn(){
    pieces = Array.from({length: 120}, ()=>({
      x: Math.random()*W, y: -20, r: 6+Math.random()*8, vy: 2+Math.random()*3, vx: -1+Math.random()*2, rot: Math.random()*360
    }));
  }
  resize(); spawn();
  const t = setInterval(()=>{
    ctx.clearRect(0,0,W,H);
    pieces.forEach(p=>{
      p.y += p.vy; p.x += p.vx; p.rot += 5;
      ctx.save(); ctx.translate(p.x,p.y); ctx.rotate(p.rot*Math.PI/180);
      ctx.fillStyle = "hsl("+(p.rot%360)+",90%,60%)";
      ctx.fillRect(-p.r/2,-p.r/2,p.r,p.r);
      ctx.restore();
    });
  }, 16);
  setTimeout(()=>{ clearInterval(t); ctx.clearRect(0,0,W,H); }, 2500);
                                               }
                                     async function startPlay(){
  document.getElementById("createCard").classList.add("hidden");
  document.getElementById("joinCard").classList.add("hidden");
  playCard.classList.remove("hidden");
  gameCodeSpan.textContent = GAME.code;

  await refreshState(); // show current question
}

async function refreshState(){
  const st = await api("/api/state/"+GAME.code);
  pt.textContent = st.total;
  pi.textContent = st.currentIndex;
  bar.style.width = (st.total ? (st.currentIndex/st.total*100) : 0) + "%";
  if (st.finished){
    finishBox.classList.remove("hidden");
    rolePill.classList.add("hidden");
    qText.textContent = "Game finished.";
    const res = await api("/api/result/"+GAME.code);
    scoreLine.innerHTML = "Score: <span class='"+(res.percent>=75?"ok":"bad")+"'>" + res.matches + "/" + res.total + " ("+res.percent+"%)</span>";
    if(res.percent>=75) confetti();
    shareBtn.onclick = async ()=>{
      const text = "We played ${APP_NAME}! Code: "+GAME.code+" — Score: "+res.matches+"/"+res.total+" ("+res.percent+"%). Try to beat us!";
      await navigator.clipboard.writeText(text);
      alert("Copied share text ✅");
    };
    rematchBtn.onclick = ()=>{
      location.reload();
    };
    return;
  }
  if (!st.question){
    qText.textContent = "Waiting…";
    return;
  }
  qText.textContent = st.question.text;
  rolePill.textContent = (st.turn === "player1") ? "Player 1 answering…" : "Player 2 guessing…";
  answerInput.value = "";
  timerTxt.textContent = "";
  if (TIMER) clearInterval(TIMER);
  let t = st.timerSec || 0;
  if (t>0){
    timerTxt.textContent = "Time: " + t + "s";
    TIMER = setInterval(()=>{
      t--; timerTxt.textContent = "Time: " + t + "s";
      if (t<=0){ clearInterval(TIMER); answerBtn.click(); }
    }, 1000);
  }
}

answerBtn.onclick = async ()=>{
  try{
    const a = answerInput.value || "";
    const res = await api("/api/answer","POST",{ code: GAME.code, player: GAME.you, answer: a });
    if (res.match) confetti();
    await refreshState();
  }catch(e){ alert(e.message); }
};

// initial state
</script>
</body>
</html>`);
});

// --------------------------- API ------------------------------------

// Create game (Player 1)
app.post("/api/create", (req, res) => {
  const name = String(req.body?.playerName || "Player 1").slice(0, 40);
  const numQuestions = clamp(parseInt(req.body?.numQuestions ?? 10, 10) || 10, 1, 100);
  const relation = String(req.body?.relation || "random");
  const timerSec = clamp(parseInt(req.body?.timerSec ?? 0, 10) || 0, 0, 120);

  const code = nanoid(6).toUpperCase();
  const questions = pickQuestions(numQuestions, relation);

  games[code] = {
    code,
    createdAt: Date.now(),
    settings: { numQuestions, relation, timerSec, theme: "romantic" },
    player1: { name, avatar: null, answers: [] },
    player2: null,
    questions,
    currentIndex: 0,
    finished: false,
    matches: 0
  };
  res.json({ code, settings: games[code].settings });
});

// Join game (Player 2)
// Join game (Player 2)
app.post("/api/join", (req, res) => {
  const code = String(req.body?.code || "").toUpperCase();
  const name = String(req.body?.playerName || "Player 2").slice(0, 40);
  const game = games[code];
  if (!game) return res.status(404).json({ error: "game not found" });
  if (game.player2) return res.status(400).json({ error: "game already has a player 2" });
  game.player2 = { name, avatar: null, answers: [] };
  res.json({ ok: true });
});

// Current state
app.get("/api/state/:code", (req, res) => {
  const code = String(req.params.code || "").toUpperCase();
  const game = games[code];
  if (!game) return res.status(404).json({ error: "game not found" });

  const total = game.settings.numQuestions;
  const idx = game.currentIndex;
  const finished = game.finished || idx >= total;

  if (finished) {
    game.finished = true;
    return res.json({ finished: true, total, currentIndex: total });
  }

  const q = game.questions[idx];
  const turn = (game.player1.answers[idx] == null) ? "player1" : "player2";
  res.json({
    finished: false,
    total,
    currentIndex: idx,
    question: { id: q.id, text: q.text, relation: q.relation },
    turn,
    timerSec: game.settings.timerSec
  });
});

// Submit answer (player1 then player2)
app.post("/api/answer", (req, res) => {
  const code = String(req.body?.code || "").toUpperCase();
  const player = String(req.body?.player || "");
  const answer = String(req.body?.answer ?? "").trim();

  const game = games[code];
  if (!game) return res.status(404).json({ error: "game not found" });

  const idx = game.currentIndex;
  if (idx >= game.settings.numQuestions) return res.status(400).json({ error: "no active question" });

  if (player === "player1") {
    if (game.player1.answers[idx] != null) return res.status(400).json({ error: "player1 already answered" });
    game.player1.answers[idx] = answer;
    return res.json({ ok: true, message: "p1 answer stored" });
  }
  if (player === "player2") {
    if (!game.player2) return res.status(400).json({ error: "player2 not in game" });
    if (game.player1.answers[idx] == null) return res.status(400).json({ error: "wait for player1 answer" });
    if (game.player2.answers[idx] != null) return res.status(400).json({ error: "player2 already answered" });
    game.player2.answers[idx] = answer;

    // match?
    const a = (game.player1.answers[idx] || "").toLowerCase();
    const b = (answer || "").toLowerCase();
    const match = a && b && a === b;
    if (match) game.matches += 1;

    // advance
    game.currentIndex += 1;
    if (game.currentIndex >= game.settings.numQuestions) {
      game.finished = true;
      const { matches, total, percent } = computeScore(game);
      leaderboard.push({
        code: game.code,
        players: [game.player1.name, game.player2.name],
        score: matches, total, ts: Date.now()
      });
      if (leaderboard.length > 200) leaderboard.shift();
    }

    return res.json({ ok: true, match, nextIndex: game.currentIndex });
  }
  return res.status(400).json({ error: "invalid player" });
});

// Result
app.get("/api/result/:code", (req, res) => {
  const code = String(req.params.code || "").toUpperCase();
  const game = games[code];
  if (!game) return res.status(404).json({ error: "game not found" });
  const { matches, total, percent } = computeScore(game);
  res.json({ matches, total, percent });
});

// Leaderboard (recent)
app.get("/api/leaderboard", (_req, res) => {
  res.json({ leaderboard: leaderboard.slice(-50).reverse() });
});

// Health
app.get("/health", (_req, res) => {
  res.json({ ok: true, games: Object.keys(games).length, questionsLoaded: QUESTIONS_POOL.length, ts: Date.now() });
});

// Cleanup old games (every hour)
setInterval(() => {
  const cutoff = Date.now() - 24 * 3600 * 1000;
  for (const code of Object.keys(games)) {
    if (games[code].createdAt < cutoff) delete games[code];
  }
}, 60 * 60 * 1000);

// ------------------------- START ------------------------------------
app.listen(PORT, () => {
  console.log(`Moyosola backend running on port ${PORT} — questions=${QUESTIONS_POOL.length}`);
});
