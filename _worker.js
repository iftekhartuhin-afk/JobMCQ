// JobMCQ v3 — Cloudflare Pages (_worker.js) / Worker | Bindings: DB (D1) | Secrets: ADMIN_PASSWORD, GEMINI_API_KEY
// Optional env: SITE_NAME, SITE_TAGLINE, DEV_NAME, GEMINI_MODELS, ANTHROPIC_API_KEY, ANTHROPIC_MODELS
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json;charset=utf-8", "cache-control": "no-store" } });
const rid = () => crypto.randomUUID().replace(/-/g, "").slice(0, 12);
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
const tok = () => hex(crypto.getRandomValues(new Uint8Array(24)));
const BD = t => new Date(t + 216e5).toISOString().slice(0, 10);
const shuf = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
// salt আকারে "ইটারেশন$সল্ট" রাখা হয়। ফ্রি প্ল্যানের CPU সীমার জন্য ডিফল্ট ২০০০০; পেইড প্ল্যানে PBKDF2_ITER দিয়ে বাড়ানো যায়।
async function hashPw(pw, saltStr) {
  const [it, salt] = String(saltStr).includes("$") ? String(saltStr).split("$") : [100000, saltStr];
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations: +it }, k, 256));
}
const newSalt = env => Math.max(1000, Math.min(100000, +env.PBKDF2_ITER || 20000)) + "$" + rid() + rid();
let ready;
function init(env) {
  const T = [
    "CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT,email TEXT UNIQUE,ph TEXT,salt TEXT,phone TEXT,body TEXT,grade TEXT,track TEXT,avatar INTEGER,plan INTEGER,exam_date TEXT,prem INTEGER DEFAULT 0,pts INTEGER DEFAULT 0,created INTEGER,last INTEGER)",
    "CREATE TABLE IF NOT EXISTS sessions(t TEXT PRIMARY KEY,uid TEXT,exp INTEGER)",
    "CREATE TABLE IF NOT EXISTS qbank(id TEXT PRIMARY KEY,s TEXT,topic TEXT,body TEXT,grade TEXT,track TEXT,src TEXT,free INTEGER,q TEXT UNIQUE,o TEXT,a INTEGER,e TEXT,created INTEGER)",
    "CREATE TABLE IF NOT EXISTS answers(uid TEXT,qid TEXT,ok INTEGER,tries INTEGER,ts INTEGER,PRIMARY KEY(uid,qid))",
    "CREATE TABLE IF NOT EXISTS activity(uid TEXT,day TEXT,n INTEGER,PRIMARY KEY(uid,day))",
    "CREATE TABLE IF NOT EXISTS tests(id TEXT PRIMARY KEY,title TEXT,mins INTEGER,neg REAL,open INTEGER,free INTEGER,body TEXT,grade TEXT,track TEXT,qids TEXT,created INTEGER)",
    "CREATE TABLE IF NOT EXISTS tatt(id TEXT PRIMARY KEY,test_id TEXT,uid TEXT,started INTEGER,submitted INTEGER,c INTEGER,w INTEGER,sk INTEGER,n INTEGER,score REAL,answers TEXT)",
    "CREATE TABLE IF NOT EXISTS payreq(id TEXT PRIMARY KEY,uid TEXT,method TEXT,trx TEXT,phone TEXT,created INTEGER,status TEXT)",
    "CREATE TABLE IF NOT EXISTS settings(k TEXT PRIMARY KEY,v TEXT)",
    "CREATE TABLE IF NOT EXISTS visitors(uid TEXT PRIMARY KEY,first INTEGER,last INTEGER,n INTEGER)",
    "CREATE INDEX IF NOT EXISTS qb_s ON qbank(s,topic)",
    "CREATE INDEX IF NOT EXISTS ans_u ON answers(uid)"
  ];
  if (!ready) ready = env.DB.batch(T.map(x => env.DB.prepare(x)));
  return ready;
}
async function byIds(env, ids, cols) {
  const m = {};
  for (let i = 0; i < ids.length; i += 80) {
    const part = ids.slice(i, i + 80);
    const r = await env.DB.prepare("SELECT " + cols + " FROM qbank WHERE id IN (" + part.map(() => "?").join(",") + ")").bind(...part).all();
    r.results.forEach(x => (m[x.id] = x));
  }
  return m;
}
const DEF = { price: "99", ticker: "", tickerBadge: "নতুন", notice: "", examName: "", examDate: "", bkash: "", nagad: "", rocket: "", wa: "", days: "36500" };
async function getSet(env) {
  const r = await env.DB.prepare("SELECT k,v FROM settings").all(), o = { ...DEF };
  r.results.forEach(x => (o[x.k] = x.v));
  return o;
}
const pubu = (u, now) => ({ id: u.id, name: u.name, email: u.email, phone: u.phone, body: u.body, grade: u.grade, track: u.track, avatar: u.avatar || 0, plan: u.plan || 45, exam_date: u.exam_date || "", pts: u.pts || 0, prem: u.prem > now, premUntil: u.prem, roll: "JM-" + new Date(u.created).getFullYear() + "-" + u.id.slice(0, 6) });
async function authUser(req, env) {
  const h = req.headers.get("authorization") || "", t = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!t) return null;
  return await env.DB.prepare("SELECT u.* FROM sessions s JOIN users u ON u.id=s.uid WHERE s.t=? AND s.exp>?").bind(t, Date.now()).first();
}
async function mkSession(env, uid, now) {
  const t = tok();
  await env.DB.prepare("INSERT INTO sessions(t,uid,exp) VALUES(?,?,?)").bind(t, uid, now + 60 * 864e5).run();
  return t;
}
async function buildResult(env, a, t) {
  const ids = JSON.parse(t.qids), ans = JSON.parse(a.answers || "{}"), m = await byIds(env, ids, "id,q,o,a,e,s,src");
  const review = ids.map(id => { const q = m[id]; if (!q) return null; const v = ans[id] == null ? -1 : +ans[id]; return { q: q.q, o: JSON.parse(q.o), a: q.a, e: q.e, s: q.s, src: q.src, pick: v >= 0 && v < 4 ? v : -1 }; }).filter(Boolean);
  const hi = await env.DB.prepare("SELECT COUNT(DISTINCT uid) c FROM tatt WHERE test_id=? AND submitted IS NOT NULL AND score>?").bind(a.test_id, a.score).first();
  const tot = await env.DB.prepare("SELECT COUNT(DISTINCT uid) c FROM tatt WHERE test_id=? AND submitted IS NOT NULL").bind(a.test_id).first();
  return { aid: a.id, testId: a.test_id, title: t.title, score: a.score, c: a.c, w: a.w, sk: a.sk, n: review.length, neg: t.neg, rank: hi.c + 1, total: tot.c, review };
}

const okq = x => x && typeof x.q === "string" && Array.isArray(x.o) && x.o.length === 4 && Number.isInteger(x.a) && x.a >= 0 && x.a < 4;

const fix = x => {
  if (x && typeof x.a === "string") { const t = x.a.trim(); let m = "0123".indexOf(t[0]); if (m < 0) m = "কখগঘ".indexOf(t[0]); if (m < 0) m = "ABCDabcd".indexOf(t[0]) % 4; x.a = m; }
  if (x && Array.isArray(x.o)) x.o = x.o.map(o => String(o));
  return x;
};
function parseQ(txt) {
  let t = txt.replace(/```json|```/g, "").trim();
  const i0 = t.indexOf("["); if (i0 > -1) t = t.slice(i0);
  let a;
  try { a = JSON.parse(t.slice(0, t.lastIndexOf("]") + 1)); } catch (e) { const k = t.lastIndexOf("}"); a = JSON.parse(t.slice(0, k + 1) + "]"); }
  if (!Array.isArray(a)) a = a.questions || [];
  return a.map(fix).filter(okq);
}

async function ai(env, p, pdf) {
  // ক্রম: Gemini মডেলগুলো (GEMINI_MODELS কমা দিয়ে লিখলে সেটাই) → তারপর ঐচ্ছিক Claude (ANTHROPIC_API_KEY থাকলে)
  const gm = (env.GEMINI_MODELS || env.GEMINI_MODEL || "gemini-3.8-flash,gemini-3.7-flash,gemini-3.5-flash").split(",").map(s => s.trim()).filter(Boolean);
  let txt = "", lastErr = "";
  if (env.GEMINI_API_KEY) {
    outer: for (const model of gm) {
      for (let k = 0; k < 2; k++) {
        const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent", {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
          body: JSON.stringify({ contents: [{ parts: (pdf ? [{ inline_data: { mime_type: "application/pdf", data: pdf } }] : []).concat([{ text: p }]) }], generationConfig: { responseMimeType: "application/json", temperature: 0.8 } })
        });
        const j = await r.json().catch(() => ({}));
        if (r.ok && j.candidates && j.candidates[0] && j.candidates[0].content) { txt = j.candidates[0].content.parts.map(x => x.text || "").join(""); break outer; }
        lastErr = model + ": " + ((j.error && j.error.message) || r.status);
        if (r.status === 429 || r.status >= 500) await new Promise(res => setTimeout(res, 1500)); else break;
      }
    }
  }
  if (!txt && env.ANTHROPIC_API_KEY) {
    for (const model of (env.ANTHROPIC_MODELS || "claude-sonnet-5-5,claude-haiku-5-5").split(",").map(s => s.trim()).filter(Boolean)) {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model, max_tokens: 8000, messages: [{ role: "user", content: pdf ? [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: pdf } }, { type: "text", text: p }] : p }] })
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.content) { txt = j.content.map(x => x.text || "").join(""); break; }
      lastErr = model + ": " + ((j.error && j.error.message) || r.status);
    }
  }
  if (!txt) throw new Error("এআই এখন ব্যস্ত, একটু পরে আবার চেষ্টা করুন। (" + (lastErr || "কোনো এপিআই কী সেট নেই") + ")");
  return txt;
}

const HINT = {
"বাংলা": "সন্ধি-বিচ্ছেদ, সমাস, প্রত্যয়-উপসর্গ, কারক-বিভক্তি, বাগধারা ও প্রবাদ, এক কথায় প্রকাশ, শুদ্ধ বানান, বাক্য শুদ্ধি, লেখক-গ্রন্থ-ছদ্মনাম, সাহিত্যের যুগ ও ইতিহাস, ধ্বনিতত্ত্ব",
"ইংরেজি": "Right form of verbs, Prepositions, Articles, Voice, Narration, Tense, Synonyms/Antonyms, One-word substitution, Idioms & phrases, Sentence correction, Translation, Literature (author-work)",
"গণিত": "শতকরা, লাভ-ক্ষতি, সুদ, অনুপাত-সমানুপাত, গড়, সময় ও কাজ, সময় ও দূরত্ব, ল.সা.গু-গ.সা.গু, বীজগণিত, জ্যামিতি-ক্ষেত্রফল-আয়তন, ধারা, বয়স, মিশ্রণ, সম্ভাবনা-ক্রমচয়",
"সাধারণ জ্ঞান (বাংলাদেশ)": "মুক্তিযুদ্ধ ও ঐতিহাসিক ঘটনা, সংবিধান, ভূগোল-নদী-জেলা, অর্থনীতি-বাজেট-GDP, শিল্প-সংস্কৃতি-সাহিত্য, জাতীয় প্রতীক, প্রশাসন ও সরকারি সংস্থা, সাম্প্রতিক ঘটনা, বিশ্ব ঐতিহ্য",
"সাধারণ জ্ঞান (আন্তর্জাতিক)": "জাতিসংঘ ও আন্তর্জাতিক সংস্থা (প্রতিষ্ঠা-সদর দপ্তর), দেশ-রাজধানী-মুদ্রা, চুক্তি-সম্মেলন, পুরস্কার, ভূগোল-নদী-পর্বত, বিশ্ব ইতিহাসের গুরুত্বপূর্ণ ঘটনা, সাম্প্রতিক বিশ্ব ঘটনা",
"সাধারণ বিজ্ঞান": "দৈনন্দিন জীবনে পদার্থ-রসায়ন-জীববিজ্ঞান, ভিটামিন ও রোগ, মৌলিক পদার্থ, আলো-শব্দ-তাপ, পরিবেশ ও জলবায়ু, আবিষ্কার ও আবিষ্কারক",
"মানসিক দক্ষতা": "সংখ্যা-অক্ষর ধারা, সাংকেতিক ভাষা, রক্তসম্পর্ক, দিক নির্ণয়, ভেনচিত্র, যুক্তি ও সিদ্ধান্ত",
"কম্পিউটার ও আইসিটি": "কম্পিউটারের মৌলিক ধারণা, ইন্টারনেট ও নেটওয়ার্ক, ডেটাবেস, সংখ্যা পদ্ধতি, সফটওয়্যার-হার্ডওয়্যার, তথ্য নিরাপত্তা, বাংলাদেশের আইসিটি উদ্যোগ",
"ইলেকট্রিক্যাল": "ওহমের সূত্র ও সার্কিট বিশ্লেষণ, ট্রান্সফরমার, ডিসি/এসি মেশিন, ইন্ডাকশন মোটর, পাওয়ার সিস্টেম-ট্রান্সমিশন, পাওয়ার ফ্যাক্টর, সুইচগিয়ার-প্রটেকশন, বৈদ্যুতিক পরিমাপ, ওয়্যারিং ও নিরাপত্তা, বিদ্যুৎ আইন-বিধি",
"সিভিল": "কংক্রিট ও সিমেন্ট টেকনোলজি, স্ট্রেংথ অব ম্যাটেরিয়ালস, স্ট্রাকচার, সার্ভেয়িং, মাটি ও ফাউন্ডেশন, ওয়াটার সাপ্লাই-সুয়ারেজ, হাইড্রোলিক্স, রোড ও ব্রিজ, এস্টিমেটিং-কস্টিং, বিল্ডিং কোড (BNBC)",
"মেকানিক্যাল": "থার্মোডাইনামিক্স, তাপ ইঞ্জিন ও কার্নো চক্র, ফ্লুইড মেকানিক্স-পাম্প-টারবাইন, আইসি ইঞ্জিন, মেশিন ডিজাইন, ম্যাটেরিয়াল সায়েন্স, রেফ্রিজারেশন, ওয়েল্ডিং-ম্যানুফ্যাকচারিং",
"পদার্থবিজ্ঞান": "বল ও গতি, কাজ-ক্ষমতা-শক্তি, তাপগতিবিদ্যা, তরঙ্গ-শব্দ-আলো, বিদ্যুৎ ও চুম্বকত্ব, আধুনিক পদার্থবিজ্ঞান",
"রসায়ন": "পর্যায় সারণি, রাসায়নিক বন্ধন, মোলের ধারণা, অম্ল-ক্ষারক, তড়িৎ রসায়ন, জৈব যৌগ, রাসায়নিক সাম্যাবস্থা",
"জীববিজ্ঞান": "কোষ ও টিস্যু, জেনেটিক্স, মানব শারীরতত্ত্ব, উদ্ভিদ ও প্রাণীর শ্রেণিবিন্যাস, বাস্তুবিদ্যা, জৈবপ্রযুক্তি",
"উচ্চতর গণিত": "ত্রিকোণমিতি, ক্যালকুলাস, ম্যাট্রিক্স-নির্ণায়ক, ভেক্টর, কনিক, জটিল সংখ্যা, সমাবেশ-সম্ভাবনা"
};

async function gen(env, b) {
  const n = Math.max(1, Math.min(15, +b.n || 10)), eng = b.subject === "ইংরেজি";
  const p = "তুমি বাংলাদেশের বিসিএস, নন-ক্যাডার ও ভর্তি পরীক্ষার ১৫ বছরের অভিজ্ঞ প্রশ্নবিশ্লেষক। বিগত ১০ বছরের প্রশ্নে বারবার আসা গুরুত্বপূর্ণ টপিক থেকেই প্রশ্ন করবে; অপ্রচলিত বা পরীক্ষায় কখনো আসবে না এমন তথ্য নয়। এই বিষয়ের গুরুত্বপূর্ণ টপিক: " + (HINT[b.subject] || b.subject) + "। পরীক্ষা: " + b.style + "। বিষয়: " + b.subject + "। ঠিক " + n + "টি " + b.difficulty + " মানের MCQ বানাও, বিগত বছরের প্রকৃত পরীক্ষার ধাঁচে ও প্যাটার্নে। নিয়ম: ১) ৪টি অপশন, একটিই নিশ্চিত সঠিক উত্তর। ২) তথ্য পাঠ্যবই বা স্বীকৃত সূত্রে প্রমাণিত ও ১০০% নিশ্চিত না হলে সেই প্রশ্ন দিও না; বিতর্কিত বা একাধিক উত্তর হতে পারে এমন প্রশ্ন বাদ দাও। ৩) প্রশ্ন ছোট, স্পষ্ট ও সরাসরি হবে, আসল পরীক্ষার ভাষা ও ধরনে। অপশনগুলো একই ধরনের, বাস্তবসম্মত ও পরস্পর আলাদা হবে; ‘উপরের সবগুলো/কোনোটিই নয়’ ধরনের বা উদ্ভট অপশন দেবে না। ভুল অপশনগুলো এমন হবে যা কম প্রস্তুত পরীক্ষার্থী সত্যিই বেছে নিতে পারে। ৪) " + (eng ? "প্রশ্ন ও অপশন ইংরেজিতে, ব্যাখ্যা বাংলায়।" : "প্রশ্ন বাংলায় (প্রয়োজনীয় ইংরেজি পরিভাষা থাকতে পারে)।") + " ৫) ব্যাখ্যা ১-২ বাক্যে বাংলায়, গণিতে সংক্ষিপ্ত সমাধানসহ। ৬) সঠিক উত্তরের অবস্থান এলোমেলো রাখো। " +
    (b.refs ? "নিচে বিগত পরীক্ষার আসল কিছু প্রশ্ন দেওয়া হলো। এগুলোর ধাঁচ, কাঠিন্য ও বিষয়বস্তুর প্যাটার্ন অনুসরণ করো, হুবহু কপি করো না:\n" + String(b.refs).slice(0, 6000) + "\n" : "") + (b.avoid && b.avoid.length ? "এই প্রশ্নগুলো বা এদের মতো একই প্রশ্ন আবার দিও না: " + b.avoid.join(" | ") + "\n" : "") +
    'আউটপুট শুধু JSON অ্যারে: [{"q":"প্রশ্ন","o":["১","২","৩","৪"],"a":0,"e":"ব্যাখ্যা","t":"টপিকের নাম"}] — a হলো সঠিক অপশনের ইনডেক্স (০ থেকে ৩), t হলো ছোট টপিকের নাম (যেমন সন্ধি, শতকরা, সংবিধান)।';
  const txt = await ai(env, p);
  const a = parseQ(txt);
  if (!a.length) throw new Error("এআই ব্যবহারযোগ্য প্রশ্ন দেয়নি, আবার চেষ্টা করুন");
  return a.map(x => ({ q: x.q, o: x.o, a: x.a, e: x.e || "", s: b.subject, src: b.src || "", t: x.t || "" }));
}

async function pubApi(env, req, p, B, Q, now, me) {
  const need = () => J({ error: "আগে লগইন করুন" }, 401);
  const prem = !!(me && me.prem > now);
  if (p === "/api/visit") {
    if (!B.uid) return J({ ok: 0 }, 400);
    await env.DB.prepare("INSERT INTO visitors(uid,first,last,n) VALUES(?,?,?,1) ON CONFLICT(uid) DO UPDATE SET last=?,n=n+1").bind(String(B.uid).slice(0, 60), now, now, now).run();
    return J({ ok: 1 });
  }
  if (p === "/api/public") {
    const [q, f, t, u] = await Promise.all([
      env.DB.prepare("SELECT COUNT(*) c FROM qbank").first(), env.DB.prepare("SELECT COUNT(*) c FROM qbank WHERE free=1").first(),
      env.DB.prepare("SELECT COUNT(*) c FROM tests WHERE open=1").first(), env.DB.prepare("SELECT COUNT(*) c FROM users").first()
    ]);
    const s = await getSet(env);
    return J({ qn: q.c, free: f.c, tests: t.c, users: u.c, price: s.price, ticker: s.ticker, tickerBadge: s.tickerBadge, notice: s.notice, examName: s.examName, examDate: s.examDate, pay: { bkash: s.bkash, nagad: s.nagad, rocket: s.rocket }, wa: s.wa });
  }
  if (p === "/api/subjects") {
    const r = await env.DB.prepare("SELECT s,topic,COUNT(*) c,SUM(free) f FROM qbank GROUP BY s,topic ORDER BY s,topic").all();
    return J(r.results);
  }
  // ---------- auth ----------
  if (p === "/api/auth/register") {
    const name = String(B.name || "").trim().slice(0, 60), email = String(B.email || "").trim().toLowerCase().slice(0, 120), pw = String(B.password || "");
    if (!name) return J({ error: "নাম লিখুন" }, 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return J({ error: "সঠিক ইমেইল দিন" }, 400);
    if (pw.length < 6) return J({ error: "পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে" }, 400);
    if (await env.DB.prepare("SELECT 1 x FROM users WHERE email=?").bind(email).first()) return J({ error: "এই ইমেইলে আগেই অ্যাকাউন্ট আছে, লগইন করুন" }, 409);
    const id = rid(), salt = newSalt(env), ph = await hashPw(pw, salt);
    await env.DB.prepare("INSERT INTO users(id,name,email,ph,salt,phone,body,grade,track,avatar,plan,exam_date,prem,pts,created,last) VALUES(?,?,?,?,?,?,?,?,?,0,45,'',0,0,?,?)")
      .bind(id, name, email, ph, salt, String(B.phone || "").slice(0, 20), String(B.body || "").slice(0, 60), String(B.grade || "").slice(0, 40), String(B.track || "").slice(0, 40), now, now).run();
    const u = await env.DB.prepare("SELECT * FROM users WHERE id=?").bind(id).first();
    return J({ token: await mkSession(env, id, now), user: pubu(u, now) });
  }
  if (p === "/api/auth/login") {
    const u = await env.DB.prepare("SELECT * FROM users WHERE email=?").bind(String(B.email || "").trim().toLowerCase()).first();
    if (!u || (await hashPw(String(B.password || ""), u.salt)) !== u.ph) return J({ error: "ইমেইল বা পাসওয়ার্ড ভুল" }, 401);
    await env.DB.prepare("UPDATE users SET last=? WHERE id=?").bind(now, u.id).run();
    return J({ token: await mkSession(env, u.id, now), user: pubu(u, now) });
  }
  if (p === "/api/logout") {
    const h = req.headers.get("authorization") || "";
    if (h.startsWith("Bearer ")) await env.DB.prepare("DELETE FROM sessions WHERE t=?").bind(h.slice(7)).run();
    return J({ ok: 1 });
  }
  if (p === "/api/me") return me ? J({ user: pubu(me, now) }) : need();
  if (p === "/api/profile") {
    if (!me) return need();
    const name = String(B.name || me.name).trim().slice(0, 60) || me.name, plan = [15, 30, 45, 60, 90].includes(+B.plan) ? +B.plan : me.plan || 45;
    const ed = /^\d{4}-\d{2}-\d{2}$/.test(B.exam_date || "") ? B.exam_date : B.exam_date === "" ? "" : me.exam_date || "";
    await env.DB.prepare("UPDATE users SET name=?,avatar=?,body=?,grade=?,track=?,plan=?,exam_date=? WHERE id=?")
      .bind(name, Math.max(0, Math.min(9, +B.avatar || 0)), String(B.body == null ? me.body : B.body).slice(0, 60), String(B.grade == null ? me.grade : B.grade).slice(0, 40), String(B.track == null ? me.track : B.track).slice(0, 40), plan, ed, me.id).run();
    if (B.password) {
      if (String(B.password).length < 6) return J({ error: "পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে" }, 400);
      const salt = newSalt(env);
      await env.DB.prepare("UPDATE users SET ph=?,salt=? WHERE id=?").bind(await hashPw(String(B.password), salt), salt, me.id).run();
    }
    return J({ user: pubu(await env.DB.prepare("SELECT * FROM users WHERE id=?").bind(me.id).first(), now) });
  }
  // ---------- practice ----------
  if (p === "/api/questions") {
    if (!me) return need();
    const s = Q.get("s") || "", topic = Q.get("topic") || "", mode = Q.get("mode") || "new", search = (Q.get("search") || "").trim();
    const off = Math.max(0, +Q.get("offset") || 0), lim = Math.min(30, Math.max(1, +Q.get("limit") || 15));
    const w = ["1=1"], a = [];
    if (s) { w.push("q.s=?"); a.push(s); }
    if (topic) { w.push("q.topic=?"); a.push(topic); }
    if (search) { w.push("q.q LIKE ?"); a.push("%" + search.slice(0, 60) + "%"); }
    if (mode === "new") w.push("a.qid IS NULL"); else if (mode === "done") w.push("a.qid IS NOT NULL"); else if (mode === "wrong") w.push("(a.ok=0 OR a.tries>1)");
    const base = " FROM qbank q LEFT JOIN answers a ON a.qid=q.id AND a.uid=? WHERE " + w.join(" AND "), fw = prem ? "" : " AND q.free=1";
    const tot = await env.DB.prepare("SELECT COUNT(*) c" + base + fw).bind(me.id, ...a).first();
    const rows = await env.DB.prepare("SELECT q.id,q.q,q.o,q.s,q.topic,q.src,q.a qa,q.e,a.ok,a.tries" + base + fw + " ORDER BY q.created,q.id LIMIT ? OFFSET ?").bind(me.id, ...a, lim, off).all();
    let locked = 0;
    if (!prem) locked = (await env.DB.prepare("SELECT COUNT(*) c" + base + " AND q.free=0").bind(me.id, ...a).first()).c;
    return J({ total: tot.c, locked, items: rows.results.map(r => { const o = { id: r.id, q: r.q, o: JSON.parse(r.o), s: r.s, topic: r.topic, src: r.src }; if (r.tries != null) { o.done = 1; o.ok = r.ok; o.a = r.qa; o.e = r.e; } return o; }) });
  }
  if (p === "/api/answer") {
    if (!me) return need();
    const q = await env.DB.prepare("SELECT * FROM qbank WHERE id=?").bind(B.qid).first();
    if (!q) return J({ error: "প্রশ্ন পাওয়া যায়নি" }, 404);
    if (!q.free && !prem) return J({ error: "এই প্রশ্ন পাস ছাড়া খোলা যাবে না", locked: 1 }, 402);
    const pick = Number(B.pick);
    if (!(pick >= 0 && pick < 4)) return J({ error: "অপশন ঠিক নেই" }, 400);
    const ok = pick === q.a ? 1 : 0, prev = await env.DB.prepare("SELECT ok FROM answers WHERE uid=? AND qid=?").bind(me.id, q.id).first();
    if (prev) await env.DB.prepare("UPDATE answers SET ok=?,tries=tries+1,ts=? WHERE uid=? AND qid=?").bind(ok, now, me.id, q.id).run();
    else await env.DB.prepare("INSERT INTO answers(uid,qid,ok,tries,ts) VALUES(?,?,?,1,?)").bind(me.id, q.id, ok, now).run();
    await env.DB.prepare("INSERT INTO activity(uid,day,n) VALUES(?,?,1) ON CONFLICT(uid,day) DO UPDATE SET n=n+1").bind(me.id, BD(now)).run();
    if (!prev && ok) await env.DB.prepare("UPDATE users SET pts=pts+1 WHERE id=?").bind(me.id).run();
    return J({ ok: !!ok, a: q.a, e: q.e });
  }
  if (p === "/api/stats") {
    if (!me) return need();
    const t = await env.DB.prepare("SELECT COUNT(*) n,COALESCE(SUM(ok),0) c FROM answers WHERE uid=?").bind(me.id).first();
    const d = await env.DB.prepare("SELECT day,n FROM activity WHERE uid=? ORDER BY day DESC LIMIT 90").bind(me.id).all(), map = {};
    d.results.forEach(x => (map[x.day] = x.n));
    const last7 = []; for (let i = 6; i >= 0; i--) { const k = BD(now - i * 864e5); last7.push({ day: k, n: map[k] || 0 }); }
    let streak = 0, i = map[BD(now)] ? 0 : 1; while (map[BD(now - i * 864e5)]) { streak++; i++; }
    return J({ total: t.n, correct: t.c, today: map[BD(now)] || 0, streak, last7, best: Math.max(0, ...Object.values(map)) });
  }
  // ---------- model tests ----------
  if (p === "/api/tests") {
    const rows = await env.DB.prepare("SELECT id,title,mins,neg,free,body,grade,track,qids FROM tests WHERE open=1 ORDER BY created DESC").all(), done = {};
    if (me) (await env.DB.prepare("SELECT test_id,id,score,n FROM tatt WHERE uid=? AND submitted IS NOT NULL ORDER BY submitted DESC").bind(me.id).all()).results.forEach(x => { if (!done[x.test_id]) done[x.test_id] = { id: x.id, score: x.score, n: x.n }; });
    return J(rows.results.map(t => ({ id: t.id, title: t.title, mins: t.mins, neg: t.neg, free: t.free, body: t.body, grade: t.grade, track: t.track, n: JSON.parse(t.qids).length, locked: !t.free && !prem, done: done[t.id] || null })));
  }
  if (p === "/api/test/start") {
    if (!me) return need();
    const t = await env.DB.prepare("SELECT * FROM tests WHERE id=? AND open=1").bind(B.testId).first();
    if (!t) return J({ error: "পরীক্ষা পাওয়া যায়নি" }, 404);
    if (!t.free && !prem) return J({ error: "এই মডেল টেস্ট দিতে পাস দরকার", locked: 1 }, 402);
    let a = await env.DB.prepare("SELECT * FROM tatt WHERE test_id=? AND uid=? AND submitted IS NULL ORDER BY started DESC").bind(t.id, me.id).first();
    if (a && now - a.started > t.mins * 60000 + 60000) a = null;
    if (!a) { a = { id: rid(), started: now }; await env.DB.prepare("INSERT INTO tatt(id,test_id,uid,started,n) VALUES(?,?,?,?,?)").bind(a.id, t.id, me.id, now, JSON.parse(t.qids).length).run(); }
    const ids = JSON.parse(t.qids), m = await byIds(env, ids, "id,q,o");
    return J({ aid: a.id, title: t.title, mins: t.mins, neg: t.neg, started: a.started, now, qs: ids.filter(id => m[id]).map(id => ({ id, q: m[id].q, o: JSON.parse(m[id].o) })) });
  }
  if (p === "/api/test/submit") {
    if (!me) return need();
    const a = await env.DB.prepare("SELECT * FROM tatt WHERE id=? AND uid=?").bind(B.aid, me.id).first();
    if (!a) return J({ error: "অ্যাটেম্পট পাওয়া যায়নি" }, 404);
    if (a.submitted) return J({ error: "আগেই জমা দেওয়া হয়েছে", done: 1 }, 409);
    const t = await env.DB.prepare("SELECT * FROM tests WHERE id=?").bind(a.test_id).first();
    const ids = JSON.parse(t.qids), m = await byIds(env, ids, "id,a"), ans = B.answers && typeof B.answers === "object" ? B.answers : {}, clean = {};
    let c = 0, w = 0, sk = 0; const st = [];
    ids.forEach(id => {
      const q = m[id]; if (!q) return;
      const v = ans[id] == null ? -1 : Number(ans[id]);
      if (!(v >= 0 && v < 4)) { sk++; return; }
      clean[id] = v;
      const ok = v === q.a ? 1 : 0; ok ? c++ : w++;
      st.push(env.DB.prepare("INSERT INTO answers(uid,qid,ok,tries,ts) VALUES(?,?,?,1,?) ON CONFLICT(uid,qid) DO UPDATE SET ok=excluded.ok,tries=tries+1,ts=excluded.ts").bind(me.id, id, ok, now));
    });
    const score = Math.round((c - w * t.neg) * 100) / 100, first = await env.DB.prepare("SELECT COUNT(*) c FROM tatt WHERE test_id=? AND uid=? AND submitted IS NOT NULL").bind(t.id, me.id).first();
    st.push(env.DB.prepare("UPDATE tatt SET submitted=?,c=?,w=?,sk=?,score=?,answers=? WHERE id=?").bind(now, c, w, sk, score, JSON.stringify(clean), a.id));
    if (c + w) st.push(env.DB.prepare("INSERT INTO activity(uid,day,n) VALUES(?,?,?) ON CONFLICT(uid,day) DO UPDATE SET n=n+excluded.n").bind(me.id, BD(now), c + w));
    if (!first.c && score > 0) st.push(env.DB.prepare("UPDATE users SET pts=pts+? WHERE id=?").bind(Math.round(score), me.id));
    await env.DB.batch(st);
    return J(await buildResult(env, { ...a, submitted: now, c, w, sk, score, answers: JSON.stringify(clean) }, t));
  }
  if (p === "/api/test/result") {
    if (!me) return need();
    const a = await env.DB.prepare("SELECT * FROM tatt WHERE id=? AND uid=? AND submitted IS NOT NULL").bind(Q.get("aid") || "", me.id).first();
    if (!a) return J({ error: "ফলাফল পাওয়া যায়নি" }, 404);
    const t = await env.DB.prepare("SELECT * FROM tests WHERE id=?").bind(a.test_id).first();
    if (!t) return J({ error: "পরীক্ষাটি আর নেই" }, 404);
    return J(await buildResult(env, a, t));
  }
  if (p === "/api/my/tests") {
    if (!me) return need();
    return J((await env.DB.prepare("SELECT a.id,a.score,a.n,a.submitted,t.title FROM tatt a LEFT JOIN tests t ON t.id=a.test_id WHERE a.uid=? AND a.submitted IS NOT NULL ORDER BY a.submitted DESC LIMIT 20").bind(me.id).all()).results);
  }
  if (p === "/api/leaderboard") {
    const lim = prem ? 50 : 5;
    const rows = await env.DB.prepare("SELECT name,pts,body,avatar FROM users WHERE pts>0 ORDER BY pts DESC,created ASC LIMIT ?").bind(lim).all();
    const tot = await env.DB.prepare("SELECT COUNT(*) c FROM users WHERE pts>0").first();
    let mine = null;
    if (me) mine = { pts: me.pts, rank: (await env.DB.prepare("SELECT COUNT(*) c FROM users WHERE pts>?").bind(me.pts).first()).c + 1 };
    return J({ rows: rows.results, total: tot.c, mine, locked: !prem && tot.c > 5 });
  }
  // ---------- payment ----------
  if (p === "/api/pay") {
    if (!me) return need();
    const method = ["bkash", "nagad", "rocket", "cash"].includes(B.method) ? B.method : "bkash", trx = String(B.trx || "").trim().slice(0, 30);
    if (trx.length < 4) return J({ error: "ট্রানজেকশন আইডি/রেফারেন্স লিখুন" }, 400);
    if ((await env.DB.prepare("SELECT COUNT(*) c FROM payreq WHERE uid=? AND status='pending'").bind(me.id).first()).c >= 3) return J({ error: "আগের অনুরোধগুলো যাচাই হওয়ার অপেক্ষায় আছে" }, 429);
    await env.DB.prepare("INSERT INTO payreq(id,uid,method,trx,phone,created,status) VALUES(?,?,?,?,?,?,'pending')").bind(rid(), me.id, method, trx, String(B.phone || "").slice(0, 20), now).run();
    return J({ ok: 1 });
  }
  if (p === "/api/pay/mine") {
    if (!me) return need();
    return J((await env.DB.prepare("SELECT id,method,trx,created,status FROM payreq WHERE uid=? ORDER BY created DESC LIMIT 5").bind(me.id).all()).results);
  }
  return null;
}

async function admApi(env, p, B, Q, now) {
  const grant = async (uid, days) => {
    const u = await env.DB.prepare("SELECT prem FROM users WHERE id=?").bind(uid).first();
    await env.DB.prepare("UPDATE users SET prem=? WHERE id=?").bind(Math.max(now, u.prem || 0) + days * 864e5, uid).run();
  };
  if (p === "/api/admin/login") return J({ ok: 1 });
  if (p === "/api/admin/stats") {
    const c = async (sql, ...a) => (await env.DB.prepare(sql).bind(...a).first()).c, day = now - 864e5;
    const list = await env.DB.prepare("SELECT u.name,t.title,a.submitted,a.score,a.n,a.c,a.w,a.sk FROM tatt a JOIN users u ON u.id=a.uid LEFT JOIN tests t ON t.id=a.test_id WHERE a.submitted IS NOT NULL ORDER BY a.submitted DESC LIMIT 30").all();
    return J({
      users: await c("SELECT COUNT(*) c FROM users"), prem: await c("SELECT COUNT(*) c FROM users WHERE prem>?", now), newToday: await c("SELECT COUNT(*) c FROM users WHERE created>?", day),
      visitors: await c("SELECT COUNT(*) c FROM visitors"), vToday: await c("SELECT COUNT(*) c FROM visitors WHERE last>?", day),
      started: await c("SELECT COUNT(*) c FROM tatt"), submitted: await c("SELECT COUNT(*) c FROM tatt WHERE submitted IS NOT NULL"),
      answers: await c("SELECT COUNT(*) c FROM answers"), pending: await c("SELECT COUNT(*) c FROM payreq WHERE status='pending'"), qn: await c("SELECT COUNT(*) c FROM qbank"), list: list.results
    });
  }
  if (p === "/api/admin/settings") {
    if (B.set) { for (const k of Object.keys(DEF)) if (k in B.set) await env.DB.prepare("INSERT INTO settings(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(k, String(B.set[k]).slice(0, 400)).run(); }
    return J(await getSet(env));
  }
  if (p === "/api/admin/qadd") {
    const tg = B.tags || {}, qs = (B.qs || []).map(fix).filter(okq);
    if (!qs.length) return J({ error: "প্রশ্ন নেই" }, 400);
    const before = (await env.DB.prepare("SELECT COUNT(*) c FROM qbank").first()).c;
    for (let i = 0; i < qs.length; i += 50)
      await env.DB.batch(qs.slice(i, i + 50).map(x => env.DB.prepare("INSERT OR IGNORE INTO qbank(id,s,topic,body,grade,track,src,free,q,o,a,e,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .bind(rid(), x.s || tg.s || "", x.t || tg.topic || "", String(tg.body || ""), String(tg.grade || ""), String(tg.track || ""), String(x.src || tg.src || ""), tg.free ? 1 : 0, x.q, JSON.stringify(x.o), x.a, x.e || "", now)));
    const after = (await env.DB.prepare("SELECT COUNT(*) c FROM qbank").first()).c;
    return J({ added: after - before, skipped: qs.length - (after - before) });
  }
  if (p === "/api/admin/qstats") return J((await env.DB.prepare("SELECT s,COUNT(*) c,SUM(free) f FROM qbank GROUP BY s ORDER BY c DESC").all()).results);
  if (p === "/api/admin/qlist") {
    const w = ["1=1"], a = [], s = Q.get("s") || "", sr = (Q.get("search") || "").trim(), off = Math.max(0, +Q.get("offset") || 0);
    if (s) { w.push("s=?"); a.push(s); } if (sr) { w.push("q LIKE ?"); a.push("%" + sr.slice(0, 60) + "%"); }
    const tot = (await env.DB.prepare("SELECT COUNT(*) c FROM qbank WHERE " + w.join(" AND ")).bind(...a).first()).c;
    const r = await env.DB.prepare("SELECT id,s,topic,body,grade,track,src,free,q,o,a FROM qbank WHERE " + w.join(" AND ") + " ORDER BY created DESC LIMIT 20 OFFSET ?").bind(...a, off).all();
    return J({ total: tot, rows: r.results.map(x => ({ ...x, o: JSON.parse(x.o) })) });
  }
  if (p === "/api/admin/qdel") { await env.DB.prepare("DELETE FROM qbank WHERE id=?").bind(B.id).run(); return J({ ok: 1 }); }
  if (p === "/api/admin/qfree") {
    if (B.id) await env.DB.prepare("UPDATE qbank SET free=? WHERE id=?").bind(B.free ? 1 : 0, B.id).run();
    else if (B.s != null && B.n) await env.DB.prepare("UPDATE qbank SET free=1 WHERE id IN (SELECT id FROM qbank WHERE s=? AND free=0 ORDER BY RANDOM() LIMIT ?)").bind(B.s, Math.min(500, +B.n)).run();
    return J({ ok: 1 });
  }
  if (p === "/api/admin/generate") {
    if (!env.GEMINI_API_KEY && !env.ANTHROPIC_API_KEY) return J({ error: "GEMINI_API_KEY সেট করা নেই" }, 400);
    return J({ qs: await gen(env, B) });
  }
  if (p === "/api/admin/extract") {
    if (!B.pdf) return J({ error: "PDF নেই" }, 400);
    const f = +B.from || 1, t2 = +B.to || f + 19, sl = Array.isArray(B.subjects) ? B.subjects : [];
    const pr = "এই PDF-এ বিগত চাকরি/ভর্তি পরীক্ষার MCQ প্রশ্ন আছে। প্রশ্ন নং " + f + " থেকে " + t2 + " পর্যন্ত প্রশ্নগুলো বের করো। নিয়ম: ১) প্রশ্ন ও অপশন PDF-এ যেমন আছে হুবহু (বাংলা/ইংরেজি) রাখো, নিজে বদলাবে না। ২) ঠিক ৪টি অপশন না থাকলে বা পড়া না গেলে সেই প্রশ্ন বাদ দাও। ৩) সঠিক উত্তর PDF-এর উত্তরমালা/চিহ্ন থেকে নাও; না থাকলে নিজে সমাধান করে সবচেয়ে সঠিকটা দাও। ৪) c = \"high\" যদি উত্তর PDF-এ ছিল বা তুমি ১০০% নিশ্চিত, নইলে \"low\"। ৫) s = এই তালিকার সবচেয়ে মানানসই বিষয় (হুবহু): " + sl.join(", ") + "। ৬) e = ১ বাক্যে বাংলায় ব্যাখ্যা। ৭) t = ছোট টপিকের নাম। এই নম্বর সীমায় প্রশ্ন না থাকলে খালি অ্যারে দাও। আউটপুট শুধু JSON অ্যারে: [{\"q\":\"\",\"o\":[\"\",\"\",\"\",\"\"],\"a\":0,\"c\":\"high\",\"s\":\"\",\"t\":\"\",\"e\":\"\"}] — a হলো সঠিক অপশনের ইনডেক্স (০-৩)।";
    const txt = await ai(env, pr, B.pdf);
    return J({ qs: parseQ(txt).map(x => ({ q: x.q, o: x.o, a: x.a, e: x.e || "", t: x.t || "", c: x.c === "high" ? "" : "low", s: sl.indexOf(x.s) > -1 ? x.s : "", src: B.src || "" })) });
  }
  if (p === "/api/admin/test/create") {
    const subs = Array.isArray(B.subjects) ? B.subjects : [], n = Math.max(1, Math.min(300, +B.n || 30)), w = [], a = [];
    for (const k of ["body", "grade", "track"]) if (B[k]) { w.push(k + "=?"); a.push(B[k]); }
    if (B.onlyFree) w.push("free=1");
    const wh = w.length ? " AND " + w.join(" AND ") : "";
    let ids = [];
    if (subs.length) { const per = Math.ceil(n / subs.length); for (const s of subs) ids = ids.concat((await env.DB.prepare("SELECT id FROM qbank WHERE s=?" + wh + " ORDER BY RANDOM() LIMIT ?").bind(s, ...a, per).all()).results.map(x => x.id)); }
    else ids = (await env.DB.prepare("SELECT id FROM qbank WHERE 1=1" + wh + " ORDER BY RANDOM() LIMIT ?").bind(...a, n).all()).results.map(x => x.id);
    if (B.mix) ids = shuf(ids);
    ids = ids.slice(0, n);
    if (!ids.length) return J({ error: "ভান্ডারে এই শর্তে কোনো প্রশ্ন মেলেনি" }, 400);
    if (!B.title) return J({ error: "পরীক্ষার নাম দিন" }, 400);
    await env.DB.prepare("INSERT INTO tests(id,title,mins,neg,open,free,body,grade,track,qids,created) VALUES(?,?,?,?,1,?,?,?,?,?,?)").bind(rid(), String(B.title).slice(0, 120), +B.mins || 30, +B.neg || 0, B.free ? 1 : 0, String(B.body || ""), String(B.grade || ""), String(B.track || ""), JSON.stringify(ids), now).run();
    return J({ ok: 1, n: ids.length });
  }
  if (p === "/api/admin/tests") return J((await env.DB.prepare("SELECT t.id,t.title,t.mins,t.neg,t.open,t.free,t.body,t.grade,t.track,t.qids,(SELECT COUNT(*) FROM tatt WHERE test_id=t.id) at,(SELECT COUNT(*) FROM tatt WHERE test_id=t.id AND submitted IS NOT NULL) sb FROM tests t ORDER BY t.created DESC").all()).results.map(t => ({ ...t, n: JSON.parse(t.qids).length, qids: undefined })));
  if (p === "/api/admin/test/toggle") { await env.DB.prepare("UPDATE tests SET open=? WHERE id=?").bind(B.open ? 1 : 0, B.id).run(); return J({ ok: 1 }); }
  if (p === "/api/admin/test/free") { await env.DB.prepare("UPDATE tests SET free=? WHERE id=?").bind(B.free ? 1 : 0, B.id).run(); return J({ ok: 1 }); }
  if (p === "/api/admin/test/delete") { await env.DB.prepare("DELETE FROM tests WHERE id=?").bind(B.id).run(); return J({ ok: 1 }); }
  if (p === "/api/admin/test/results") {
    const t = await env.DB.prepare("SELECT id,title,qids FROM tests WHERE id=?").bind(B.id).first();
    if (!t) return J({ error: "পরীক্ষা নেই" }, 404);
    const r = await env.DB.prepare("SELECT u.name,u.email,a.started,a.submitted,a.c,a.w,a.sk,a.n,a.score FROM tatt a JOIN users u ON u.id=a.uid WHERE a.test_id=? AND a.submitted IS NOT NULL ORDER BY a.score DESC,(a.submitted-a.started) ASC").bind(B.id).all();
    const st = await env.DB.prepare("SELECT COUNT(*) c FROM tatt WHERE test_id=?").bind(B.id).first();
    return J({ title: t.title, n: JSON.parse(t.qids).length, started: st.c, rows: r.results });
  }
  if (p === "/api/admin/pay") return J((await env.DB.prepare("SELECT p.id,p.method,p.trx,p.phone,p.created,p.status,u.name,u.email FROM payreq p JOIN users u ON u.id=p.uid ORDER BY (p.status='pending') DESC,p.created DESC LIMIT 100").all()).results);
  if (p === "/api/admin/pay/act") {
    const r = await env.DB.prepare("SELECT * FROM payreq WHERE id=?").bind(B.id).first();
    if (!r || r.status !== "pending") return J({ error: "অনুরোধ পাওয়া যায়নি" }, 404);
    if (B.action === "approve") { await grant(r.uid, +B.days || +(await getSet(env)).days || 36500); await env.DB.prepare("UPDATE payreq SET status='approved' WHERE id=?").bind(r.id).run(); }
    else await env.DB.prepare("UPDATE payreq SET status='rejected' WHERE id=?").bind(r.id).run();
    return J({ ok: 1 });
  }
  if (p === "/api/admin/grant") {
    const u = await env.DB.prepare("SELECT id FROM users WHERE email=?").bind(String(B.email || "").trim().toLowerCase()).first();
    if (!u) return J({ error: "এই ইমেইলে কোনো ইউজার নেই" }, 404);
    if (B.revoke) await env.DB.prepare("UPDATE users SET prem=0 WHERE id=?").bind(u.id).run(); else await grant(u.id, +B.days || 36500);
    return J({ ok: 1 });
  }
  if (p === "/api/admin/users") {
    const sr = "%" + String(Q.get("search") || "").trim().slice(0, 40) + "%";
    return J((await env.DB.prepare("SELECT id,name,email,phone,body,pts,prem,created FROM users WHERE name LIKE ? OR email LIKE ? ORDER BY created DESC LIMIT 100").bind(sr, sr).all()).results);
  }
  return J({ error: "not found" }, 404);
}

export default {
  async fetch(req, env) {
    const u = new URL(req.url), p = u.pathname, now = Date.now();
    if (p === "/") {
      const SITE = { name: env.SITE_NAME || "JobMCQ", tag: env.SITE_TAGLINE || "সরকারি চাকরির প্রস্তুতি ও মডেল টেস্ট", dev: env.DEV_NAME || "Junaid" };
      return new Response(HTML.replace("__SITE__", () => JSON.stringify(SITE).replace(/</g, "\\u003c")), { headers: { "content-type": "text/html;charset=utf-8", "cache-control": "no-cache" } });
    }
    if (p === "/manifest.webmanifest") return new Response(JSON.stringify({ name: env.SITE_NAME || "JobMCQ", short_name: env.SITE_NAME || "JobMCQ", start_url: "/", display: "standalone", background_color: "#ffffff", theme_color: "#2a55e0", lang: "bn", icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }, { src: "/icon-512.png", sizes: "512x512", type: "image/png" }] }), { headers: { "content-type": "application/manifest+json" } });
    if (p === "/sw.js") return new Response('self.addEventListener("install",e=>self.skipWaiting());self.addEventListener("activate",e=>e.waitUntil(self.clients.claim()));self.addEventListener("fetch",()=>{});', { headers: { "content-type": "text/javascript" } });
    if (p === "/icon-192.png" || p === "/icon-512.png") return new Response(Uint8Array.from(atob(p === "/icon-192.png" ? ICON192 : ICON512), c => c.charCodeAt(0)), { headers: { "content-type": "image/png", "cache-control": "public,max-age=86400" } });
    if (!p.startsWith("/api/")) return new Response("Not found", { status: 404 });
    try {
      await init(env);
      const B = req.method === "POST" ? await req.json().catch(() => ({})) : {}, Q = u.searchParams;
      if (p.startsWith("/api/admin/")) {
        if (!env.ADMIN_PASSWORD || req.headers.get("x-admin") !== env.ADMIN_PASSWORD) return J({ error: "পাসওয়ার্ড ভুল" }, 401);
        return await admApi(env, p, B, Q, now);
      }
      const me = await authUser(req, env);
      return (await pubApi(env, req, p, B, Q, now, me)) || J({ error: "not found" }, 404);
    } catch (e) { return J({ error: String(e.message || e) }, 500); }
  }
};
const ICON192 = "iVBORw0KGgoAAAANSUhEUgAAAMAAAADACAYAAABS3GwHAAAEA0lEQVR42u3cPVIbQRRF4ekuRRR7QDFk3oEXAblXRo4W4R04QzHswaUUBw5sXOXS74y6+35nBdKbe/q+lkBlaoz7x7ePCcOy3axLS6+nCDuSpShCj2QZiuAjWYQi+EgWoQg+kkUogo9kEarwoycunbEi+Ehugyr8SG6DKvxIlqAKP5IlqMKPZAmq8CNZgir8SJagCj+SJajCj2QJqvAjWYJqTEimOv2R3AJV+JEsgRUIViCnP1JbQANAAzj9kdoCGgAawOmP1BbQANAATn+ktoAGgAYAogWw/iB1DdIA0AAAAQACAFkUF2BoACCUVdobfn2589T38PD0bgUSeiTIUIUfyfOrHh6S51g9NCTPs3pYSJ5r9ZCQPN/q4SB5zr4IQzQEAAHUMlLnrQGgAQACAAQACAAQACAAQACAAAABAAIABADGYGUEf/j+YxfzXr9+ufHANUBm+BPfLwGEwfsmAEAAgAAAAUAAI8j9SNBHoQSIDYPw/8YXYUKhAQACAAQACAAQACAAQACAAAABAAIAA+FPIf6ip/+Q8mcbGiA2/D2+XgIIk9dNAIAAAAEAAjRCr5+o+CSIALFhEv7L4HsAodIAAAEAAgAEAAgAEAAgAEZg93xrCATIDj8JCBB/8pOAAPFrDwkIEL/z755viUAAF950CQgQHH4SECA+/NM0TTfffhIAwk8ACD8BIPwEgPATAMJPAAg/ASD8BIDwEwDCTwAIPwEg/ASA8BMA7SD8BIg9/YWfAMIPArSwhws/AYYJ/1ISCD8Bmj3555ZA+AnQ/Noz1y8p+HUGAsTeC3zWT4Auw30JCYSfAF2f7OdIIPwEGGKtWfJ3eISfALNxTriW+CU24SdA8xIc8nucwk+A5iWYow2EnwCxK5HwEyBWAuEngCYQfgKkSiD8BHA5Fn4CaAPhJwAJhJ8AJBB+ApBA+AmQLIHwE2AoCY4JtPATILYNhJ8AERL8G/QlvkfA8ayMYDkJoAEAAszBw9O7p2neGgAgAJAogDXInOMbgATmG78CkcBc4+8AJDDP+EswCcwxWgASmN8+yv3j20fSA319uZNqh0auAMCnFWi7WRdjQCLbzbr4JhjZDWAEIABAACBUABdhJF6ANQA0gBGAANYgBK4/GgAa4H9mAKOf/hoAGmCfIcCop78GgAY41BRgtNNfA0ADHGsMMMrpv7cBSICRw28FghXoXIOAXk//gxuABBgx/EetQCTAaOE/+g5AAowU/pMuwSTAKOE/SQASYJTwnywACTBC+M8SgAToPfxnC0AC9Bz+aZqmi4bXD+2il+BfrAG0AXoN/8UbQBugl+DPLgAR0MNWsdjKQgS0uE4vvrMTAS3dI696aSUDrhH6ZgQghbBfm191+OGB9IEyOQAAAABJRU5ErkJggg==";
const ICON512 = "iVBORw0KGgoAAAANSUhEUgAAAgAAAAIACAYAAAD0eNT6AAAM2UlEQVR42u3dMVIbTRuFUU2XIsp7gBgydsAicO6VkcMivANnEMMeXKQ4ogqrhG1JM57u956zgP83AzP3mRafPW3o0uXt85urAFTw9HAxuQr98U0x8AACQQBg7AFEgQDA4AMIAgGAwQcQBALA6AMgBgSA0QdADAgAow+AGBAAhh8AISAAjD4AYkAAGH4AhIAAMPwACAEBYPgBEAICwPADIAQEgOEHQAgcqhl/AMjbjsk3DwDyTgPKfVGGHwAh8HelPgIw/gDYmKATAMMPgNOAsBMA4w+A7QkLAOMPgA06zuSiA8BpRvxIYLgTAOMPgG0KCwDjD4CNmsfkogLAvEb4SKD7EwDjD4DTgLAAMP4AiICwADD+AIiAsAAw/gCIgLAAMP4AiICwADD+AIiAsAAw/gCIgLAAMP4AiICwADD+AIiAsAAw/gCIgLAAMP4AiID1trClfcEAIAJWCADjDwDrb2Or/gUCgAhYMQCMPwD0s5Wt2hcEACKgoxMAAKAfiweAt38A6G872+hfAACIgI4CwPgDQL9b6ncAACDQIgHg7R8A+t7UNsofFABEQKcBYPwBYIwI8DsAABBotgDw9g8A45wCtN7+QADA8pvrIwAACHRyAHj7B4DxTgGcAACAEwBv/wCQcArQ1vo/BgDWiwAfAQBAoKMCwNs/AIx9CuAEAACcAHj7B4CEUwAnAADgBMDbPwAknAI4AQAAJwDe/gEg4RTACQAAOAHw9g8ACacATgAAwAkAACAANo7/AWA0/7LdTgAAwAmAt38ASDgFcAIAAE4AAIDoAHD8DwBj+9OWOwEAACcAAEBsADj+B4AaPtt0JwAA4AQAAIgMAMf/AFDLvm13AgAATgAAAAEAANQPAJ//A0BNuxvvBAAA0k8AAAABAABUDwCf/wNAbR+33gkAACSfAAAAAgAAEAAAQLkA8AuAAJDhffOdAABA6gkAACAAAAABAAAIAABAAAAAAgAAGMDk7wCgF4/35y4CEa6+vrgICACMPSAKEAAYfhACIAAw+iAGQABg+EEIwCz8VwAYf3A/4QQAPKjAaQBOAMD4g/sMAQAeSuB+QwCAhxG47xAAeAgB7j8EAB4+gPsQAYCHDuB+RADgYQO4LxEAeMgA7k8EAB4ugPsUAQAACAC8VQDuVwQAHiaA+xYBAAAIALxFgPsXBAAAIAAAQADAbxwfgvsYAQAACAC8NQDuZwQAACAAAAABAAAIAABAANAdvzAE7msEAAAgAAAAAQAACAAAQAAAAAIAABAAAIAAAAAEAAAgAAAAAQAACAAAQAAAAAIAABAAAIAAAAABAAAIAABAAAAAAgAAEAAAgAAAAAQAACAAAAABAAAIAABAAAAAAgAAEAAAgAAAAAQAALDH1iWgmu8/Xl0EFnFzfeYiIADA8JP6MyYEqMBHABh/8POGAAAPY/BzhwAAD2Hw84cAAA9f8HOIAAAABAB468LPIwgAAEAAAAACAAAQAACAAAAABAAAIADAP8aCn0cQAACAAMBbF/g5BAGAhy/4+QMBgIcw+LkDAYCHMfh5I9PWJaDaQ9k/zILhBwGAhzQAe/gIAAAEAAAgAAAAAQAACAAAQAAAAAIAABAAAIAAAAAEAAAgAAAAAQAACAAAQAAAAAIAABAAAIAAAAAEAAAIAABAAAAAAgAAEAAAgAAAAAQAACAAAAABAAAIAABAAAAAAgAAmN3WJaCi7z9eXYSB3FyfuQggAMDwp37fhAAIADD8QgBYkN8BwPjjewoCAAwFvrcgAAAAAQDeEPE9BgEAAAgA8GaI7zUIAABAAAAAAgAAEAAAgAAAAAQA7PJ3xfteAwIAABAAeDPE9xgQAACAAMAbIr63gADAUOB7CpG2LgGVBsPfG2/4AQGAEMDwAwIAgwLAO78DAAACAAAQAACAAAAABAAAIAAAAAEAAAgAAEAAAAACAAAQAACAAAAABAAAIAAAAAEAAAgAAEAAAAACAAAEAAAgAAByvd59cREQAACJ4y8CEAAAoW/+IgABABA2/iIAAQAQOv4iAAEAEDr+IgABABA6/iIAAQAQOv4iAAEAEDr+IgABABA6/iIAAQAQOv4iAAEAEDr+IgABABA6/iIAAQAQOv4iAAEAEDr+IgABABA6/iIAAQAQOv4iAAEAED6+IgABABA6uiIAAQAQOrYiAAEAEDiyZ99++gYhAACMPwgAAOMPAgDA+IMAADD+IAAAjD8IAMD4G38QAIDxN/4gAADjb/xBAADG3/iDAACMv/FHAAAYf+OPAAAw/sYfAQBg/I0/AgDA+IMAADD+IAAAjD8IAADjDwIAwPiDAACMv/EHAQAYf+MPAgAw/sYfBABg/I0/CADA+Bt/EACA8Tf+IAAA42/8QQAAxt/4gwAAjL/xRwAAGH8QAADGHwQAgPEHAQBg/EEAABh/EACA8Tf+IAAA42/8QQAAxt/4gwAAjL/xBwEAGH/jDwIAMP7GHwQAYPyNPwgACBk118n4gwCABUdNBBh/EAAQOmoiwPiDAIDgsRMCxh8EAIQOmwgw/iAAIHTYkiPA+IMAgOhhS4wA4w8CAAzbJuv3Aow/CAAg7DTA+IMAAOMWFgHGHwQAGLewCDD+IADA+B/wv1shBIw/CAAw/mGnAcYfBAAY/7AIMP6AAICwCDD+gADAGM/8/9t7CBh/QABg/MNG1vgDAgDjHza2xh8QABj/sD+T8QcEAKwwvmsOsPEHBADe/sP+jMYfEAAY/7A/q/EHBACljTYm6X87ofEHAQDREbDkv1Hg+wQIAKIiIP00wPgDAgCnAWERYPwBAYAICIsA4w8IABg4Ao4ZcuMPCADYM0CVTwOMPyAAoNhpgPEHBACIAOMPCABIioDdsTf+gACAI0dq1NMA4w8IAAg8DXAtAQEAhss1BAQAGDDXDhAAcPCQGTPjDwIAjBquEwgAMG64PiAAwMi5LoAAgLpjZ/CMPwgAMHyuASAAwAD62gEBAIbQ1wwIAKg7iCmjaPxBAABh42j8QQAAYSNp/EEAAGFjafxBAAAHjGaF4TT+IACAsAE1/iAAgLAhNf4gAICwQTX+IACAmYe193E1/oAAgLCRNf6AAICwsTX+gACAsNE1/oAAgBXGd80BNv6AAICwt3DjDwgACIsA4w8IAAiLAOMPCADoNAKWGmnjDwgACDsNMP6AAICgCKjyLxMCAgDiIuDYATf8wKGmy9vnN5eBXY/35y5CB17vvhh9ZnH19cVF4DdblwD6PhUAWIKPAABAAAAAAgAAEADk8AtD4H5GAAAAAgBvDYD7GAEAAAgAAEAAMDjHh+D+RQAAAAIAbxGA+xYBgIcJ4H5FAAAAAgBvFYD7FAGAhwvg/kQA4CEDuC8RAHjYAO5HBAAeOoD7EAGAhw/g/kMA4CEE7jsQAHgYgfsNBAAeSuA+gz2my9vnN5eBuT3en7sIYPhxAoCHFeB+wgkATgMAw48AQAwARh8BgBAAww9LB8Bms9mIAEQBGHtyPD1cTFuXAQ9FgDz+KwAAEAAAgAAAAAQAACAAAAABAAAMFQBPDxeTSwEA9b1vvhMAAEg9AQAABAAAIAAAgLIB4BcBAaC2j1vvBAAAkk8AAAABAACkBIDfAwCAmnY33gkAAKSfAAAAAgAASAkAvwcAALXs23YnAADgBAAAiA0AHwMAQA2fbboTAABwAgAARAeAjwEAYGx/2nInAADgBAAAiA8AHwMAwJj+tuFOAADACYBTAACo/vbvBAAAnAAAAALgAx8DAMAY/nWznQAAgBMApwAAUP3t3wkAADgBcAoAAAlv/04AAMAJgFMAAEh4+3cCAABOAJwCAEDC278TAABwAuAUAAAS3v5PPgEQAQAw3vifHAAAwJhODgCnAAAw1tu/EwAAcALgFAAAEt7+Zz0BEAEAMMb4zxoAAMA4Zg0ApwAA0P/b/yInACIAAPrf1jbKHxQAjH/nAQAA9G2xAHAKAAD9bmkb9Q8OAMa/0wAQAQDQ53b6HQAACPRfAsApAAD0tZmt2hcEAMa/owAQAQDQz0a26l8gABj/DgJABADA+pvY0r5gAEgf/1UDQAQAYPzX09IvAAAkbl9zIQAgb/OaCwIAeVvXXBgAyNu45gIBQN62NRcKAPI2rblgAJC3Zc2FA4C8DWsuIADkbddQ43p5+/zmxwoAwx9wAuA0AAAbFR4AIgAA2zSPocfURwIAGP6QEwCnAQDYoPAAEAEA2J7jlBpPHwkAYPhDTgCcBgBgY8JPAJwGAGD4wwNACABg+D/XfAMBIG87osbRaQAAXhoDA0AIAJA+/NEBIAQASB1+ASAEAAx/MAEgBAAMvwBADAAYfQGAEAAw/AJADIgBAKMvAMQAAEZfAIgBAIy+ABAEABh8ASAIADD4AkAUiAIAYy8AEAiAged/+gUoT/xQVD7oFQAAAABJRU5ErkJggg==";

const HTML = String.raw`<!DOCTYPE html>
<html lang="bn"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#2a55e0"><link rel="manifest" href="/manifest.webmanifest"><link rel="icon" href="/icon-192.png"><link rel="apple-touch-icon" href="/icon-192.png">
<title>JobMCQ</title>
<meta name="description" content="সরকারি চাকরির পরীক্ষার প্রস্তুতি: বিসিএস, নন-ক্যাডার, বুয়েট ও MIST প্যাটার্ন, ৯ম–২০তম গ্রেড। বিষয়ভিত্তিক প্রশ্নব্যাংক, মডেল টেস্ট ও র‍্যাংকিং।">
<style>
:root{--bg:#f6f8fc;--c:#fff;--t:#111a2e;--m:#5b6a85;--p:#2a55e0;--p2:#1d3fae;--pl:#eaf0ff;--ok:#12a36b;--okl:#e4f7ef;--no:#dc2f4a;--nol:#fdebee;--am:#f59e0b;--aml:#fff6e0;--b:#e0e6f1;--dk:#0e1730;--sh:0 6px 24px rgba(30,50,110,.08)}
@media(prefers-color-scheme:dark){:root{--bg:#0b1222;--c:#141d33;--t:#e8edf8;--m:#9fb0cc;--p:#6d8dff;--p2:#8ba4ff;--pl:#1b2748;--okl:#10302a;--nol:#3a1a24;--aml:#33290f;--b:#26324f;--dk:#060b18;--sh:0 6px 24px rgba(0,0,0,.35)}}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--t);font-family:"Noto Sans Bengali","Hind Siliguri",system-ui,-apple-system,sans-serif;line-height:1.65;padding-top:env(safe-area-inset-top,0px)}
h1,h2,h3{line-height:1.3;margin:.2em 0}h2{font-size:1.2rem}h3{font-size:1.05rem}
button{font:inherit;cursor:pointer}input,select,textarea{font:inherit;width:100%;padding:11px 12px;border:1px solid var(--b);border-radius:12px;background:var(--c);color:var(--t);margin:4px 0 10px;outline:none}input:focus,select:focus,textarea:focus{border-color:var(--p)}
label{font-weight:600;font-size:.9rem;color:var(--m)}
.w{max-width:760px;margin:auto;padding:14px}.m{color:var(--m);font-size:.9rem}.tc{text-align:center}.row{display:flex;gap:10px;flex-wrap:wrap}.row>*{flex:1;min-width:120px}
.card{background:var(--c);border:1px solid var(--b);border-radius:18px;padding:16px;margin:12px 0;box-shadow:var(--sh)}
.btn{background:var(--p);color:#fff;border:0;border-radius:12px;padding:11px 18px;font-weight:700;box-shadow:0 6px 16px rgba(42,85,224,.28)}.btn:disabled{opacity:.55}.btn.g{background:transparent;color:var(--p);border:1px solid var(--p);box-shadow:none}.btn.am{background:var(--am);box-shadow:0 6px 16px rgba(245,158,11,.3)}.btn.wide{width:100%}.btn.sm{padding:7px 12px;font-size:.88rem;border-radius:10px}
.ic{vertical-align:-4px;flex:none}
.top{position:sticky;top:0;z-index:30;background:var(--c);border-bottom:1px solid var(--b);display:flex;justify-content:space-between;align-items:center;gap:8px;padding:10px 12px;padding-top:calc(10px + env(safe-area-inset-top,0px));margin-top:calc(-1 * env(safe-area-inset-top,0px))}
.brand{display:flex;align-items:center;gap:9px;font-size:1.02rem;min-width:0}.brand b{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.logo{width:36px;height:36px;border-radius:11px;background:var(--p);display:flex;align-items:center;justify-content:center;color:#fff;flex:none}
.hr{display:flex;align-items:center;gap:7px}.chip{border:1px solid var(--b);background:var(--bg);color:var(--t);border-radius:12px;padding:6px 10px;font-weight:700;display:flex;align-items:center;gap:6px;font-size:.9rem}.chip.pass{background:var(--p);color:#fff;border-color:var(--p)}
.av{width:26px;height:26px;border-radius:50%;color:#fff;display:inline-flex;align-items:center;justify-content:center;font-weight:800;font-size:.85rem}.rl{max-width:84px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.8rem}
.ibtn{border:0;background:transparent;color:var(--m);padding:6px}
.tick{background:var(--dk);color:#fff;display:flex;gap:10px;align-items:center;padding:10px 14px;font-size:.92rem}.tick .bg{background:rgba(245,158,11,.18);color:#ffc65a;border:1px solid rgba(245,158,11,.5);border-radius:20px;padding:2px 12px;font-weight:700;white-space:nowrap}
.hero{padding:34px 16px 26px;background:linear-gradient(180deg,var(--pl),var(--bg));text-align:left}.hero .in{max-width:760px;margin:auto}
.badge{display:inline-flex;gap:8px;align-items:center;background:var(--aml);color:#9a5b00;border:1px solid #f6d58a;border-radius:14px;padding:6px 14px;font-weight:700;font-size:.88rem}
.hero h1{font-size:2rem;margin:.5em 0 .2em}.hero h1 span{color:var(--p);display:block}.hero p{color:var(--m);font-size:1.02rem}
.stats{background:var(--dk);color:#fff;display:grid;grid-template-columns:1fr 1fr;gap:20px;padding:28px 18px;text-align:center}.stats b{display:block;font-size:2rem;color:#ffc65a}.stats div:nth-child(2) b{color:#7f9bff}.stats div:nth-child(3) b{color:#37d6a0}.stats div:nth-child(4) b{color:#fff}.stats span{color:#b8c4de;font-size:.88rem}
.sec{padding:30px 14px;max-width:760px;margin:auto}.sec h2{font-size:1.5rem;text-align:center}.sec .sub{text-align:center;color:var(--m);margin-bottom:16px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px}.cat{background:var(--c);border:1px solid var(--b);border-radius:16px;padding:14px;text-align:left;color:var(--t);font-weight:700;display:flex;gap:10px;align-items:center}.cat .ci{width:38px;height:38px;border-radius:12px;background:var(--pl);color:var(--p);display:flex;align-items:center;justify-content:center;flex:none}
.acc{background:var(--c);border:1px solid var(--b);border-radius:18px;overflow:hidden}.acc details{border-bottom:1px solid var(--b)}.acc details:last-child{border:0}.acc summary{list-style:none;padding:14px 16px;cursor:pointer;display:flex;gap:12px;align-items:center}.acc summary::-webkit-details-marker{display:none}.acc .bx{width:40px;height:40px;border-radius:12px;background:var(--pl);color:var(--p);display:flex;align-items:center;justify-content:center;flex:none}.acc .ti{flex:1;font-weight:700}.acc .tp{padding:0 16px 12px 68px;font-size:.92rem;color:var(--m)}.acc .tp div{display:flex;justify-content:space-between;padding:3px 0}
.plan{border:2px solid var(--b);border-radius:20px;padding:20px;background:var(--c);position:relative;margin:16px 0}.plan.hot{border-color:var(--p);box-shadow:0 10px 30px rgba(42,85,224,.18)}.plan .tagp{position:absolute;top:-13px;left:50%;transform:translateX(-50%);background:var(--p);color:#fff;border-radius:14px;padding:3px 18px;font-weight:800;font-size:.8rem;letter-spacing:.06em;white-space:nowrap}
.price{font-size:2.3rem;font-weight:800}.plan ul{list-style:none;padding:0;margin:14px 0}.plan li{display:flex;gap:10px;padding:5px 0}.plan li svg{color:var(--ok);margin-top:5px}
table.cmp{width:100%;border-collapse:collapse;font-size:.92rem;background:var(--c);border-radius:16px;overflow:hidden;border:1px solid var(--b)}.cmp th,.cmp td{padding:11px 10px;border-bottom:1px solid var(--b);text-align:left}.cmp th{background:var(--bg)}.cmp td:last-child,.cmp th:last-child{background:var(--pl);color:var(--p);font-weight:700}
.foot{background:var(--dk);color:#c3cee6;padding:28px 18px 90px;font-size:.92rem}.foot .in{max-width:760px;margin:auto}.foot a,.foot summary{color:#a9bcff;cursor:pointer}.foot hr{border:0;border-top:1px solid #243157;margin:18px 0}.foot p{margin:.5em 0}
.bn{position:fixed;left:0;right:0;bottom:0;z-index:40;background:var(--c);border-top:1px solid var(--b);display:flex;padding:6px 4px calc(6px + env(safe-area-inset-bottom,0px))}.bn button{flex:1;border:0;background:transparent;color:var(--m);display:flex;flex-direction:column;align-items:center;gap:1px;font-size:.68rem;font-weight:600;padding:4px 0;position:relative}.bn button.on{color:var(--p)}.bn button.on::after{content:"";width:5px;height:5px;border-radius:50%;background:var(--p);position:absolute;bottom:-3px}.bn .pz{color:var(--p);font-weight:800}.bn .pz span{background:var(--pl);border-radius:50%;width:34px;height:34px;display:flex;align-items:center;justify-content:center}
body.ex .bn{display:none}main{padding:12px 12px 100px;max-width:760px;margin:auto;min-height:70vh}
.ib{background:linear-gradient(90deg,var(--p),var(--p2));color:#fff;padding:9px 14px;display:flex;align-items:center;gap:10px;font-size:.9rem}.ib .btn{background:var(--am);box-shadow:none;padding:6px 14px;color:#2a1d00}.ib .x{margin-left:auto;background:transparent;border:0;color:#fff}
.q .qh{display:flex;gap:8px;align-items:center;margin-bottom:8px}.tag{background:var(--pl);color:var(--p);border-radius:9px;padding:2px 10px;font-weight:800;font-size:.85rem}.qt{font-size:1.04rem;font-weight:600;margin:6px 0 12px}
.op{display:flex;gap:10px;align-items:center;width:100%;text-align:left;background:var(--c);color:var(--t);border:1.5px solid var(--b);border-radius:14px;padding:10px 12px;margin:8px 0}.op i{font-style:normal;font-weight:700;width:34px;height:30px;border-radius:9px;background:var(--bg);border:1px solid var(--b);display:flex;align-items:center;justify-content:center;flex:none;font-size:.85rem}
.op.sel{border-color:var(--p);background:var(--pl)}.op.ok{border-color:var(--ok);background:var(--okl)}.op.no{border-color:var(--no);background:var(--nol)}.op:disabled{opacity:1}
.ex{margin-top:10px;padding:11px 13px;border-radius:12px;background:var(--aml);font-size:.93rem}.ex.ok{background:var(--okl)}.ex.no{background:var(--nol)}
.chips{display:flex;gap:8px;overflow-x:auto;padding:2px 0 8px;-webkit-overflow-scrolling:touch}.chips button{white-space:nowrap;border:1.5px solid var(--b);background:var(--c);color:var(--t);border-radius:12px;padding:8px 14px;font-weight:600}.chips button.on{background:var(--p);border-color:var(--p);color:#fff}
.seg{display:flex;gap:8px;margin:8px 0}.seg button{flex:1;border:1.5px solid var(--b);background:var(--c);color:var(--t);border-radius:13px;padding:10px;font-weight:700}.seg button.on{background:var(--p);color:#fff;border-color:var(--p)}
.sbar{display:flex;align-items:center;gap:8px;background:var(--bg);border:1px solid var(--b);border-radius:13px;padding:0 12px}.sbar input{border:0;margin:0;background:transparent}
.pill{display:inline-block;background:var(--pl);color:var(--p);border-radius:10px;padding:2px 10px;font-weight:700;font-size:.82rem;margin:2px 4px 2px 0}.pill.fr{background:var(--okl);color:var(--ok)}.pill.lk{background:var(--aml);color:#9a5b00}
.bar{height:10px;background:var(--b);border-radius:6px;overflow:hidden}.bar i{display:block;height:100%;background:var(--p);width:0;border-radius:6px;transition:width .3s}
.big{font-size:2.1rem;font-weight:800;color:var(--p)}.kpi{display:flex;justify-content:space-around;text-align:center}.kpi b{display:block;font-size:1.35rem}.days{display:flex;justify-content:space-between;text-align:center;margin:10px 0}.days div{flex:1}.days span{display:block;font-size:.78rem;color:var(--m)}.dc{width:38px;height:38px;border-radius:12px;border:1.5px solid var(--b);margin:4px auto;display:flex;align-items:center;justify-content:center;font-weight:700}.dc.t{background:var(--p);color:#fff;border-color:var(--p)}.dot{width:8px;height:8px;border-radius:50%;margin:0 auto;background:var(--b)}.dot.h{background:#8aa4ff}.dot.g{background:#2fd4a0}
.rk{display:flex;gap:12px;align-items:center;border:1px solid var(--b);border-radius:16px;padding:12px;margin:10px 0;background:var(--c)}.rk .md{width:46px;height:46px;border-radius:13px;background:var(--bg);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:1.3rem;flex:none}.rk.r1{background:#fff9e3;border-color:#f2d36b}.rk.r2{background:#f2f5fa}.rk.r3{background:#fff2e6;border-color:#f6c895}@media(prefers-color-scheme:dark){.rk.r1,.rk.r2,.rk.r3{background:var(--c)}}.rk .nm{font-weight:700}.rk .pt{margin-left:auto;font-weight:800;color:#d97706;font-size:1.15rem}
.blur{filter:blur(5px);pointer-events:none}.lockbox{position:relative}.lockbox .lb{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;font-weight:700}
.top2{display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;z-index:20;background:var(--bg);padding:8px 0;font-weight:800;border-bottom:1px solid var(--b)}
.mdl{position:fixed;inset:0;z-index:100;background:rgba(8,14,30,.55);display:flex;align-items:flex-end;justify-content:center}.mb{background:var(--c);width:100%;max-width:560px;border-radius:22px 22px 0 0;max-height:92vh;overflow:auto;padding:0 16px 22px}.mh{display:flex;justify-content:space-between;align-items:center;padding:16px 0 8px;position:sticky;top:0;background:var(--c);z-index:2}.mh .x{border:0;background:transparent;color:var(--m)}.tabs2{display:flex;border-bottom:1px solid var(--b);margin-bottom:12px}.tabs2 button{flex:1;border:0;background:transparent;padding:11px;font-weight:700;color:var(--m);border-bottom:3px solid transparent}.tabs2 button.on{color:var(--p);border-color:var(--p)}
.avs{display:flex;gap:10px;margin:6px 0 12px}.avs button{width:42px;height:42px;border-radius:50%;border:3px solid transparent;color:#fff;font-weight:800}.avs button.on{border-color:var(--p);outline:2px solid var(--pl)}
#toast{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(86px + env(safe-area-inset-bottom,0px));background:#16203a;color:#fff;padding:10px 16px;border-radius:12px;display:none;z-index:200;max-width:90%;font-size:.93rem}
.warn{background:var(--aml);border-color:#f3d18a}.okb{background:var(--okl);border-color:#9fe3c7}.nob{background:var(--nol);border-color:#f3a6b3}
table.t{width:100%;border-collapse:collapse;font-size:.85rem}table.t td,table.t th{border-bottom:1px solid var(--b);padding:6px;text-align:left}.sc{overflow-x:auto}
.tabs{display:flex;gap:6px;overflow-x:auto;margin:8px 0}.tabs button{white-space:nowrap}
.dl{display:block;font-size:.8rem;color:var(--m)}
</style></head><body><div id="v"></div><div id="toast"></div>
<script>
var SITE=__SITE__;document.title=SITE.name+" – সরকারি চাকরির প্রস্তুতি";
var $=function(i){return document.getElementById(i)},V=$("v");
var BODIES=["বিসিএস/বিপিএসসি","নন-ক্যাডার","বুয়েট প্যাটার্ন","MIST প্যাটার্ন","ঢাকা পলিটেকনিক","ব্যাংক","শিক্ষক নিয়োগ","বিশ্ববিদ্যালয় ভর্তি","অন্যান্য"];
var GRADES=["৯ম–১০ম গ্রেড","১১শ–১২শ গ্রেড","১৩শ–১৬শ গ্রেড","১৭শ–২০তম গ্রেড"];
var TRACKS=["টেকনিক্যাল","নন-টেকনিক্যাল"];
var SUBJ=["বাংলা","ইংরেজি","গণিত","সাধারণ জ্ঞান (বাংলাদেশ)","সাধারণ জ্ঞান (আন্তর্জাতিক)","সাধারণ বিজ্ঞান","মানসিক দক্ষতা","কম্পিউটার ও আইসিটি","ইলেকট্রিক্যাল","সিভিল","মেকানিক্যাল","পদার্থবিজ্ঞান","রসায়ন","জীববিজ্ঞান","উচ্চতর গণিত"];
var STY=["বিসিএস প্রিলিমিনারি","বিপিএসসি নন-ক্যাডার","উপসহকারী প্রকৌশলী (ডিপ্লোমা ইঞ্জিনিয়ারিং, PDB/LGED/PWD)","বুয়েট/MIST ভর্তি প্যাটার্ন","বিশ্ববিদ্যালয় ভর্তি পরীক্ষা (ঢাবি/জাবি/রাবি/চবি/গুচ্ছ)","ব্যাংক ও অন্যান্য সরকারি চাকরি","শিক্ষক নিয়োগ (এনটিআরসিএ/প্রাথমিক)"];
var AVC=["#c2185b","#2a55e0","#12a36b","#d97706","#7b3fe4","#0e8aa8","#e0453a","#5b6a85","#3a8f2f","#a33fb0"];
function ls(k){try{return localStorage.getItem(k)}catch(e){return null}}
function lw(k,v){try{if(v==null)localStorage.removeItem(k);else localStorage.setItem(k,v)}catch(e){}}
var TK=0,LQ=0;
var S={u:null,t:ls("tok"),tab:ls("tab")||"home",pub:{},subj:[],ip:null},E=null,tm=null,sending=false,P=null,D=[];
function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}
function bn(n){return String(n).replace(/\d/g,function(d){return"০১২৩৪৫৬৭৮৯"[d]})}
function toast(t){var x=$("toast");x.textContent=t;x.style.display="block";clearTimeout(toast.h);toast.h=setTimeout(function(){x.style.display="none"},5000)}
function uid(){var u=ls("uid");if(!u){u=(crypto.randomUUID?crypto.randomUUID():String(Math.random()).slice(2)+Date.now());lw("uid",u)}return u}
var IC={book:'<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',alert:'<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',layers:'<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',zap:'<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',award:'<circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/>',crown:'<path d="M2 18h20M3 7l5 5 4-7 4 7 5-5-2 11H5z"/>',user:'<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',out:'<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',dl:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',search:'<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',ok:'<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',lock:'<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',flame:'<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',cal:'<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',play:'<circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/>',x:'<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',star:'<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',target:'<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',chev:'<polyline points="6 9 12 15 18 9"/>'};
function ic(n,s){return'<svg class="ic" viewBox="0 0 24 24" width="'+(s||20)+'" height="'+(s||20)+'" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+IC[n]+'</svg>'}
function logo(){return'<span class="logo">'+ic("ok",22)+'</span>'}
async function api(p,b,adm){var h={"content-type":"application/json"};if(S.t)h.authorization="Bearer "+S.t;if(adm)h["x-admin"]=sessionStorage.getItem("ap")||"";var r=await fetch(p,{method:b?"POST":"GET",headers:h,body:b?JSON.stringify(b):undefined});var d=await r.json().catch(function(){return{}});if(!r.ok){d.status=r.status;throw d}return d}
function opts(list,sel,first){return'<option value="">'+(first||"বাছাই করুন")+'</option>'+list.map(function(x){return'<option'+(x==sel?' selected':'')+'>'+esc(x)+'</option>'}).join("")}
function modal(h){closeM();var m=document.createElement("div");m.className="mdl";m.id="mdl";m.innerHTML='<div class="mb">'+h+'</div>';m.addEventListener("click",function(e){if(e.target==m)closeM()});document.body.appendChild(m)}
function closeM(){var m=$("mdl");if(m)m.remove()}
function authModal(mode,pre){var su=mode=="up";modal('<div class="mh"><b>'+(su?'নতুন অ্যাকাউন্ট খুলুন':'লগইন করুন')+'</b><button class="x" onclick="closeM()">'+ic("x")+'</button></div><div class="tabs2"><button class="'+(!su?'on':'')+'" onclick="authModal(\'in\')">লগইন</button><button class="'+(su?'on':'')+'" onclick="authModal(\'up\')">রেজিস্ট্রেশন</button></div>'+(su?'<label>পূর্ণ নাম *</label><input id="a_n" placeholder="যেমন: মোঃ তানভীর আহমেদ">':'')+'<label>ইমেইল *</label><input id="a_e" type="email" placeholder="name@gmail.com" autocomplete="email"><label>পাসওয়ার্ড *</label><input id="a_p" type="password" placeholder="কমপক্ষে ৬ অক্ষর" autocomplete="'+(su?'new-password':'current-password')+'">'+(su?'<label>পাসওয়ার্ড নিশ্চিত করুন *</label><input id="a_p2" type="password"><label>লক্ষ্য পরীক্ষা</label><select id="a_b">'+opts(BODIES,pre)+'</select><div class="row"><div><label>গ্রেড</label><select id="a_g">'+opts(GRADES)+'</select></div><div><label>ধরন</label><select id="a_t">'+opts(TRACKS)+'</select></div></div><label>মোবাইল নম্বর (ঐচ্ছিক)</label><input id="a_ph" type="tel">':'')+'<button class="btn wide" id="a_go" onclick="doAuth(\''+mode+'\')">'+(su?'অ্যাকাউন্ট খুলুন':'লগইন')+'</button>')}
async function doAuth(mode){var su=mode=="up",b={email:$("a_e").value,password:$("a_p").value};if(su){if($("a_p").value!=$("a_p2").value){toast("দুটি পাসওয়ার্ড মেলেনি");return}b.name=$("a_n").value;b.body=$("a_b").value;b.grade=$("a_g").value;b.track=$("a_t").value;b.phone=$("a_ph").value}
var g=$("a_go");g.disabled=true;try{var r=await api(su?"/api/auth/register":"/api/auth/login",b);S.t=r.token;lw("tok",r.token);S.u=r.user;closeM();toast("স্বাগতম, "+r.user.name);S.tab="home";route()}catch(e){toast(e.error||"সমস্যা হয়েছে, আবার চেষ্টা করুন");g.disabled=false}}
function logout(){api("/api/logout",{}).catch(function(){});lw("tok",null);lw("cur",null);lw("last",null);S.t=null;S.u=null;E=null;location.hash="";route()}
function profile(){var u=S.u;modal('<div class="mh"><b>'+ic("user",18)+' প্রোফাইল পরিবর্তন</b><button class="x" onclick="closeM()">'+ic("x")+'</button></div><label>অবতার রং</label><div class="avs" id="p_av">'+AVC.slice(0,6).map(function(c,i){return'<button class="'+(u.avatar==i?'on':'')+'" style="background:'+c+'" onclick="pickAv('+i+')">'+esc(u.name.charAt(0).toUpperCase())+'</button>'}).join("")+'</div><label>পূর্ণ নাম *</label><input id="p_n" value="'+esc(u.name)+'"><div class="card" style="margin:4px 0 12px;box-shadow:none;background:var(--bg)"><div class="row m"><div>ইমেইল:<br><b style="color:var(--t)">'+esc(u.email)+'</b></div><div>রোল:<br><b style="color:var(--t)">'+esc(u.roll)+'</b></div></div></div><label>লক্ষ্য পরীক্ষা</label><select id="p_b">'+opts(BODIES,u.body)+'</select><div class="row"><div><label>গ্রেড</label><select id="p_g">'+opts(GRADES,u.grade)+'</select></div><div><label>ধরন</label><select id="p_t">'+opts(TRACKS,u.track)+'</select></div></div><label>আপনার পরীক্ষার তারিখ (জানা থাকলে)</label><input id="p_d" type="date" value="'+esc(u.exam_date)+'"><label>নতুন পাসওয়ার্ড (ঐচ্ছিক)</label><input id="p_p" type="password" placeholder="কমপক্ষে ৬ অক্ষর"><button class="btn wide" onclick="saveProfile()">সম্পন্ন করুন</button>');S.av=u.avatar||0}
function pickAv(i){S.av=i;[].forEach.call(document.querySelectorAll("#p_av button"),function(b,j){b.className=j==i?"on":""})}
async function saveProfile(){try{var r=await api("/api/profile",{name:$("p_n").value,avatar:S.av,body:$("p_b").value,grade:$("p_g").value,track:$("p_t").value,exam_date:$("p_d").value,password:$("p_p").value,plan:S.u.plan});S.u=r.user;closeM();toast("প্রোফাইল হালনাগাদ হয়েছে");route()}catch(e){toast(e.error||"সমস্যা হয়েছে")}}
window.addEventListener("beforeinstallprompt",function(e){e.preventDefault();S.ip=e;var b=$("ib");if(b&&S.u)instBar()});
function instBar(){var b=$("ib");if(!b||!S.ip||ls("noinst"))return;b.innerHTML='<div class="ib">'+ic("dl")+'<span>ফোনে অ্যাপ ইনস্টল করুন</span><button class="btn sm" onclick="doInstall()">ইনস্টল (ফ্রি)</button><button class="x" onclick="lw(\'noinst\',1);$(\'ib\').innerHTML=\'\'">'+ic("x",18)+'</button></div>'}
function doInstall(){if(S.ip){S.ip.prompt();S.ip=null;$("ib").innerHTML=""}}
if("serviceWorker" in navigator)navigator.serviceWorker.register("/sw.js").catch(function(){});
function grp(){var g={};(S.subj||[]).forEach(function(r){var k=r.s||"অন্যান্য";g[k]=g[k]||{n:0,f:0,t:[]};g[k].n+=r.c;g[k].f+=(r.f||0);if(r.topic)g[k].t.push(r)});return g}
function price(){return bn((S.pub&&S.pub.price)||"99")}
async function boot(){if(S.t){try{S.u=(await api("/api/me")).user}catch(e){lw("tok",null);S.t=null}}
try{S.pub=await api("/api/public")}catch(e){}try{S.subj=await api("/api/subjects")}catch(e){}api("/api/visit",{uid:uid()}).catch(function(){});route()}
function route(){clearInterval(tm);closeM();document.body.classList.remove("ex");window.scrollTo(0,0);if(location.hash=="#admin"){admin();return}if(!S.u){landing();return}app()}
window.onhashchange=route;
function footer(app){var p=S.pub||{},wa=String(p.wa||"").replace(/\D/g,"");var y=new Date().getFullYear();
return'<footer class="foot"><div class="in"><div class="brand" style="color:#fff">'+logo()+'<b>'+esc(SITE.name)+'</b></div><p>সরকারি চাকরি ও ভর্তি পরীক্ষার প্রার্থীদের জন্য বিষয়ভিত্তিক প্রশ্নব্যাংক, ব্যাখ্যাসহ অনুশীলন ও মডেল টেস্টের প্ল্যাটফর্ম।</p><hr><details><summary>আমাদের সম্পর্কে</summary><p>'+esc(SITE.name)+' ৯ম থেকে ২০তম গ্রেডের টেকনিক্যাল ও নন-টেকনিক্যাল পদের পরীক্ষার প্রস্তুতির জন্য তৈরি। বিসিএস, নন-ক্যাডার, বুয়েট/MIST প্যাটার্ন, পলিটেকনিক ও অন্যান্য পরীক্ষার ধাঁচে প্রশ্ন সাজানো হয়।</p></details><details><summary>ডিসক্লেমার</summary><p>এই সাইটের প্রশ্ন ও উত্তর শুধু অনুশীলনের জন্য। কিছু প্রশ্ন এআই-সহায়তায় প্রস্তুত হতে পারে এবং অনিচ্ছাকৃত ভুল থাকতে পারে; গুরুত্বপূর্ণ তথ্য নির্ভরযোগ্য বই বা সরকারি সূত্র থেকে মিলিয়ে নিন। এটি বিপিএসসি বা কোনো সরকারি প্রতিষ্ঠান, বিশ্ববিদ্যালয়ের অফিসিয়াল সাইট নয়, এবং কোনো পরীক্ষার ফলাফলের নিশ্চয়তা দেয় না।</p></details><details><summary>প্রাইভেসি পলিসি</summary><p>আমরা আপনার নাম, ইমেইল, পছন্দের পরীক্ষা, অনুশীলন ও পরীক্ষার ফল সংরক্ষণ করি। পাসওয়ার্ড এনক্রিপ্টেড (হ্যাশ) অবস্থায় থাকে। তথ্য শুধু সেবা চালানো ও মান উন্নয়নে ব্যবহৃত হয়, কারও কাছে বিক্রি করা হয় না। অ্যাকাউন্ট ও তথ্য মুছতে চাইলে সাপোর্টে যোগাযোগ করুন।</p></details><details><summary>ব্যবহারের শর্তাবলী</summary><p>অ্যাকাউন্টের তথ্য সঠিক রাখা ও পাসওয়ার্ড গোপন রাখা ব্যবহারকারীর দায়িত্ব। প্রশ্ন বা কনটেন্ট অনুমতি ছাড়া কপি, বিক্রি বা অন্যত্র প্রকাশ করা যাবে না। পাস একবার সক্রিয় হলে সাইটের প্রদত্ত সুবিধা পাওয়া যাবে; নিয়ম অমান্য করলে অ্যাকাউন্ট বন্ধ হতে পারে।</p></details><details><summary>কপিরাইট</summary><p>© '+y+' '+esc(SITE.name)+'। সর্বস্বত্ব সংরক্ষিত। কারও কপিরাইট লঙ্ঘিত হয়েছে মনে করলে যোগাযোগ করুন, দ্রুত ব্যবস্থা নেওয়া হবে।</p></details>'+(wa?'<hr><p><b style="color:#fff">প্রার্থী সহায়তা ডেস্ক</b><br>অ্যাকাউন্ট বা পেমেন্ট সংক্রান্ত যেকোনো প্রশ্নে হোয়াটসঅ্যাপে যোগাযোগ করুন:</p><p><a href="https://wa.me/'+wa+'" target="_blank" rel="noopener">+'+esc(wa)+'</a></p>':'')+'<hr><p>© '+y+' '+esc(SITE.name)+' · Developed by '+esc(SITE.dev)+'</p></div></footer>'}
function landing(){var p=S.pub||{},g=grp(),ks=Object.keys(g);
V.innerHTML='<header class="top"><div class="brand">'+logo()+'<b>'+esc(SITE.name)+'</b></div><div class="hr"><button class="chip" onclick="authModal(\'in\')">লগইন</button><button class="btn sm" onclick="authModal(\'up\')">শুরু করুন</button></div></header>'+
(p.ticker?'<div class="tick"><span class="bg">'+esc(p.tickerBadge||"নতুন")+'</span><span>'+esc(p.ticker)+'</span></div>':'')+
'<section class="hero"><div class="in"><span class="badge">'+ic("star",16)+' বিগত বছরের প্রশ্ন ও সিলেবাস বিশ্লেষণে তৈরি</span><h1>সরকারি চাকরির পরীক্ষার প্রস্তুতি<span>৯ম–২০তম গ্রেড · বুয়েট ও বিপিএসসি প্যাটার্ন</span></h1><p>টেকনিক্যাল ও নন-টেকনিক্যাল—বিষয়ভিত্তিক প্রশ্নব্যাংক, ব্যাখ্যাসহ অনুশীলন, সময় ধরে মডেল টেস্ট ও র‍্যাংকিং এক জায়গায়।</p><div class="row" style="margin-top:14px"><button class="btn" onclick="authModal(\'up\')">ফ্রি শুরু করুন</button><button class="btn g" onclick="document.getElementById(\'syl\').scrollIntoView()">প্রশ্নব্যাংক দেখুন</button></div></div></section>'+
'<div class="stats"><div><b>'+bn(p.qn||0)+'+</b><span>ব্যাখ্যাসহ প্রশ্ন</span></div><div><b>'+bn(p.tests||0)+'</b><span>মডেল টেস্ট</span></div><div><b>'+bn(p.free||0)+'</b><span>ফ্রি প্রশ্ন</span></div><div><b>৳'+price()+'</b><span>একবারের পাস</span></div></div>'+
'<section class="sec"><h2>কোন পরীক্ষার প্রস্তুতি নিচ্ছেন?</h2><p class="sub">লক্ষ্য বেছে নিন, বাকিটা আমরা সাজিয়ে দেব।</p><div class="grid2">'+BODIES.map(function(b){return'<button class="cat" data-b="'+esc(b)+'" onclick="authModal(\'up\',this.dataset.b)"><span class="ci">'+ic("target",20)+'</span>'+esc(b)+'</button>'}).join("")+'</div></section>'+
'<section class="sec" id="syl"><h2>বিষয়ভিত্তিক পূর্ণাঙ্গ সিলেবাস</h2><p class="sub">প্রতিটি বিষয়ের টপিক ও প্রশ্ন সংখ্যা একনজরে দেখে নিন।</p><div class="acc">'+(ks.length?ks.map(function(k){var x=g[k];return'<details><summary><span class="bx">'+ic("book",20)+'</span><span class="ti">'+esc(k)+'<div class="m">'+bn(x.t.length)+'টি টপিক • '+bn(x.n)+'টি প্রশ্ন</div></span>'+ic("chev",20)+'</summary><div class="tp">'+(x.t.length?x.t.map(function(t){return'<div><span>'+esc(t.topic)+'</span><span>'+bn(t.c)+'টি</span></div>'}).join(""):'<div>টপিক শীঘ্রই যুক্ত হচ্ছে</div>')+'</div></details>'}).join(""):'<div class="card m">প্রশ্নব্যাংক সাজানো হচ্ছে, শীঘ্রই দেখা যাবে।</div>')+'</div></section>'+
'<section class="sec"><h2>প্রস্তুতি পরিকল্পনা নির্বাচন করুন</h2><div class="plan"><b class="m">ফ্রি ট্রায়াল</b><div class="price">০ ৳</div><div class="m">প্ল্যাটফর্মের মান যাচাই করার জন্য</div><ul><li>'+ic("ok",20)+'<span>'+bn(p.free||0)+'টি বাছাইকৃত ফ্রি প্রশ্ন</span></li><li>'+ic("ok",20)+'<span>ফ্রি মডেল টেস্ট</span></li><li>'+ic("ok",20)+'<span>ব্যক্তিগত অগ্রগতি ও ভুল ব্যাংক</span></li></ul><button class="btn g wide" onclick="authModal(\'up\')">ফ্রি শুরু করুন</button></div><div class="plan hot"><span class="tagp">সম্পূর্ণ অ্যাক্সেস</span><b style="color:var(--p)">সম্পূর্ণ অ্যাক্সেস পাস</b><div class="price">৳'+price()+'</div><div class="m">একবার পেমেন্ট, বিকাশ/নগদ/রকেটে সহজ পেমেন্ট</div><ul><li>'+ic("ok",20)+'<span>সম্পূর্ণ '+bn(p.qn||0)+'+ ব্যাখ্যাসহ প্রশ্ন</span></li><li>'+ic("ok",20)+'<span>সব মডেল টেস্ট (বুয়েট/বিপিএসসি প্যাটার্ন)</span></li><li>'+ic("ok",20)+'<span>পূর্ণাঙ্গ র‍্যাংকিং ও পয়েন্ট বোর্ড</span></li><li>'+ic("ok",20)+'<span>ভুল প্রশ্নের স্মার্ট রিভিশন ব্যাংক</span></li></ul><button class="btn wide" onclick="authModal(\'up\')">শুরু করুন</button></div></section>'+
'<section class="sec"><table class="cmp"><tr><th>সুবিধা</th><th>ফ্রি</th><th>পাস</th></tr><tr><td>অনুশীলনের প্রশ্ন</td><td>বাছাইকৃত</td><td>সম্পূর্ণ</td></tr><tr><td>মডেল টেস্ট</td><td>ফ্রি টেস্ট</td><td>সব টেস্ট</td></tr><tr><td>ভুল ব্যাংক</td><td>আছে</td><td>আছে</td></tr><tr><td>র‍্যাংকিং</td><td>শীর্ষ ৫</td><td>পূর্ণ তালিকা</td></tr></table></section>'+
'<section class="sec"><h2>সাধারণ জিজ্ঞাসা</h2><div class="acc"><details><summary><span class="ti">এটা কি সরকারি ওয়েবসাইট?</span>'+ic("chev",20)+'</summary><div class="tp" style="padding-left:16px">না। এটি প্রস্তুতির একটি বেসরকারি প্ল্যাটফর্ম, বিপিএসসি বা কোনো সরকারি প্রতিষ্ঠানের সাথে যুক্ত নয়।</div></details><details><summary><span class="ti">পাস কীভাবে কিনব?</span>'+ic("chev",20)+'</summary><div class="tp" style="padding-left:16px">রেজিস্ট্রেশনের পর "পাস" ট্যাবে গিয়ে বিকাশ/নগদ/রকেটে টাকা পাঠিয়ে ট্রানজেকশন আইডি জমা দিন। যাচাই শেষে পাস সক্রিয় হবে।</div></details><details><summary><span class="ti">টেকনিক্যাল পদের প্রশ্ন আছে?</span>'+ic("chev",20)+'</summary><div class="tp" style="padding-left:16px">হ্যাঁ। ইলেকট্রিক্যাল, সিভিল, মেকানিক্যালসহ বিষয়ভিত্তিক প্রশ্ন আছে এবং ধাপে ধাপে বাড়ছে।</div></details></div></section>'+footer();window.scrollTo(0,0)}
function app(){var u=S.u;V.innerHTML='<div id="ib"></div><header class="top"><div class="brand">'+logo()+'<b>'+esc(SITE.name)+'</b></div><div class="hr"><button class="chip pass" onclick="tab(\'pass\')">'+(u.prem?ic("crown",16)+' প্রিমিয়াম':'৳'+price())+'</button><button class="chip" onclick="profile()"><span class="av" style="background:'+AVC[u.avatar%AVC.length]+'">'+esc(u.name.charAt(0).toUpperCase())+'</span><span class="rl">'+esc(u.roll)+'</span></button><button class="ibtn" onclick="logout()" title="লগআউট">'+ic("out")+'</button></div></header><main id="main"></main><nav class="bn" id="bn">'+[["practice","book","অনুশীলন"],["mistakes","alert","ভুল ব্যাংক"],["home","layers","হোম / রুটিন"],["tests","zap","মডেল টেস্ট"],["rank","award","র‍্যাংক"]].map(function(x){return'<button data-t="'+x[0]+'" onclick="tab(\''+x[0]+'\')">'+ic(x[1],22)+x[2]+'</button>'}).join("")+'<button class="pz" data-t="pass" onclick="tab(\'pass\')"><span>'+ic("crown",20)+'</span>'+(u.prem?'পাস ✓':'৳'+price()+' পাস')+'</button></nav>';
instBar();var c=null;try{c=JSON.parse(ls("cur"))}catch(e){}if(c&&c.aid&&c.qs){E=c;S.tab="tests"}if(!ls("tab")&&!c)S.tab="home";tab(S.tab)}
function tab(t){TK++;S.tab=t;lw("tab",t);if(t!="tests")lw("last",null);clearInterval(tm);document.body.classList.remove("ex");[].forEach.call(document.querySelectorAll("#bn button"),function(b){b.className=(b.dataset.t==t?"on":"")+(b.dataset.t=="pass"?" pz":"")});window.scrollTo(0,0);({practice:tPractice,mistakes:tMistakes,home:tHome,tests:tTests,rank:tRank,pass:tPass})[t]()}
async function refreshMe(){try{S.u=(await api("/api/me")).user}catch(e){}}
var LD='<div class="card m tc">লোড হচ্ছে…</div>';
/* ---------- অনুশীলন ও ভুল ব্যাংক ---------- */
var PR={s:"",topic:"",mode:"new",search:"",items:[],total:0,locked:0,off:0,ans:0,cor:0},MI={s:"",topic:"",mode:"wrong",search:"",items:[],total:0,locked:0,off:0,ans:0,cor:0,fixed:1};
function tPractice(){P=PR;qview()}function tMistakes(){P=MI;qview()}
function qview(){var m=$("main");m.innerHTML=(P.fixed?'<div class="card nob"><b>'+ic("alert",18)+' আপনার ভুল ব্যাংক</b><div class="m">যে প্রশ্নে ভুল করেছেন বা একাধিকবার চেষ্টা করেছেন, সেগুলো নিজে থেকে এখানে জমা হয়।</div></div>':'<div class="card"><div class="m"><b>বিষয় নির্বাচন করুন:</b></div><div class="chips" id="sc"></div><div class="chips" id="tc"></div></div><div class="seg"><button id="m_new" onclick="setMode(\'new\')">নতুন / অসম্পূর্ণ</button><button id="m_done" onclick="setMode(\'done\')">সম্পন্ন</button></div>')+'<div class="card"><div class="sbar">'+ic("search",18)+'<input id="qs" placeholder="এই বিষয়ের প্রশ্নে সার্চ করুন…" value="'+esc(P.search)+'" oninput="qsearch()"></div><div class="m" id="qc" style="margin-top:8px"></div></div><div id="ql"></div><div id="qm"></div>';if(!P.fixed)chipsS();loadQ(true)}
function chipsS(){var g=grp(),ks=Object.keys(g);$("sc").innerHTML='<button class="'+(!P.s?'on':'')+'" onclick="setSub(\'\')">সব বিষয়</button>'+ks.map(function(k){return'<button class="'+(P.s==k?'on':'')+'" data-k="'+esc(k)+'" onclick="setSub(this.dataset.k)">'+esc(k)+' ('+bn(g[k].n)+')</button>'}).join("");var t=P.s&&g[P.s]?g[P.s].t:[];$("tc").innerHTML=t.length?'<button class="'+(!P.topic?'on':'')+'" onclick="setTopic(\'\')">সব টপিক</button>'+t.map(function(x){return'<button class="'+(P.topic==x.topic?'on':'')+'" data-k="'+esc(x.topic)+'" onclick="setTopic(this.dataset.k)">'+esc(x.topic)+' ('+bn(x.c)+')</button>'}).join(""):"";$("m_new").className=P.mode=="new"?"on":"";$("m_done").className=P.mode=="done"?"on":""}
function setSub(k){P.s=k;P.topic="";chipsS();loadQ(true)}function setTopic(k){P.topic=k;chipsS();loadQ(true)}function setMode(m){P.mode=m;chipsS();loadQ(true)}
var qt=null;function qsearch(){clearTimeout(qt);qt=setTimeout(function(){P.search=$("qs").value;loadQ(true)},400)}
async function loadQ(reset){if(!$("ql"))return;var tk=++LQ;if(reset){P.items=[];P.off=0;P.ans=0;P.cor=0;$("ql").innerHTML=LD;$("qm").innerHTML=""}
try{var r=await api("/api/questions?mode="+P.mode+"&s="+encodeURIComponent(P.s)+"&topic="+encodeURIComponent(P.topic)+"&search="+encodeURIComponent(P.search)+"&offset="+P.off+"&limit=15");if(tk!=LQ||!$("ql"))return;if(reset)$("ql").innerHTML="";P.total=r.total;P.locked=r.locked;var st=P.items.length;r.items.forEach(function(q){P.items.push(q)});P.off=P.items.length;$("ql").insertAdjacentHTML("beforeend",r.items.map(function(q,i){return qcard(q,st+i)}).join(""));
var mm="";if(!P.items.length)mm='<div class="card tc"><div style="color:var(--ok)">'+ic("ok",40)+'</div><h3>'+(P.fixed?'এখনো কোনো ভুল চিহ্নিত হয়নি।':'এই ফিল্টারে কোনো প্রশ্ন নেই')+'</h3><div class="m">'+(P.fixed?'অনুশীলনে প্রশ্নের উত্তর দিন—ভুল হলে বা একাধিকবার চেষ্টা করলে তা স্বয়ংক্রিয়ভাবে এখানে যুক্ত হবে।':'অন্য বিষয় বা সার্চ চেষ্টা করুন।')+'</div></div>';
if(P.items.length<P.total)mm+='<button class="btn g wide" onclick="loadQ(false)">আরও প্রশ্ন দেখান</button>';
if(P.locked>0&&!S.u.prem)mm+='<div class="card okb tc" style="margin-top:14px"><h3>পরবর্তী বিষয় ও আরও প্রশ্ন সমাধান করতে চান?</h3><div class="m">পাসে আরও '+bn(P.locked)+'টি প্রশ্ন, সব মডেল টেস্ট ও পূর্ণ র‍্যাংকিং আছে।</div><br><button class="btn wide" onclick="tab(\'pass\')">৳'+price()+' টাকায় আনলক করুন</button></div>';$("qm").innerHTML=mm;cnt()}catch(e){if(tk!=LQ||!$("ql"))return;$("ql").innerHTML='<div class="card nob">'+esc(e.error||"লোড করা যায়নি")+'</div>'}}
function cnt(){var c=$("qc");if(c)c.innerHTML='<b style="color:var(--t)">মোট প্রশ্ন: '+bn(P.total)+'</b> &nbsp;•&nbsp; এই সেশনে উত্তর: '+bn(P.ans)+' &nbsp;•&nbsp; <span style="color:var(--ok)">সঠিক: '+bn(P.cor)+'</span> &nbsp;•&nbsp; ভুল: '+bn(P.ans-P.cor)}
function qcard(q,i){var L="কখগঘ";return'<div class="card q" id="c'+q.id+'"><div class="qh"><span class="tag">প্রশ্ন #'+bn(i+1)+'</span>'+(q.topic?'<span class="m">'+esc(q.topic)+'</span>':'')+(q.src?'<span class="pill">'+esc(q.src)+'</span>':'')+'</div><div class="qt">'+esc(q.q)+'</div>'+q.o.map(function(o,j){return'<button class="op'+(q.done&&j==q.a?' ok':'')+'" '+(q.done?'disabled':'')+' onclick="ans(\''+q.id+'\','+j+')"><i>('+L[j]+')</i><span>'+esc(o)+'</span></button>'}).join("")+'<div class="ex'+(q.done?'':'" style="display:none')+'" id="x'+q.id+'">'+(q.done?'<b>সঠিক উত্তর: ('+L[q.a]+')</b> '+esc(q.e||""):'')+'</div>'+(q.done?'':'<div class="m tc" style="margin-top:6px">উত্তর দেখতে যেকোনো অপশনে ক্লিক করুন</div>')+'</div>'}
async function ans(id,j){var q=P.items.filter(function(x){return x.id==id})[0];if(!q||q.done||q.busy)return;q.busy=1;try{var r=await api("/api/answer",{qid:id,pick:j});q.done=1;q.ok=r.ok;q.a=r.a;q.e=r.e;P.ans++;if(r.ok)P.cor++;var c=$("c"+id);[].forEach.call(c.querySelectorAll(".op"),function(b,k){b.disabled=true;if(k==q.a)b.classList.add("ok");else if(k===j)b.classList.add("no")});var x=$("x"+id);x.style.display="block";x.className="ex "+(r.ok?"ok":"no");x.innerHTML=(r.ok?'✅ <b>সঠিক!</b> ':'❌ <b>ভুল।</b> সঠিক উত্তর: <b>('+"কখগঘ"[q.a]+')</b>। ')+esc(r.e||"");if(c.lastChild&&c.lastChild.className=="m tc")c.lastChild.remove();cnt()}catch(e){q.busy=0;toast(e.locked?"এই প্রশ্ন পাস ছাড়া খোলা যাবে না":(e.error||"সমস্যা হয়েছে"))}}
/* ---------- হোম / রুটিন ---------- */
async function tHome(){var m=$("main"),k=TK;m.innerHTML=LD;await refreshMe();var u=S.u,p=S.pub||{},st={total:0,correct:0,today:0,streak:0,last7:[],best:0};try{st=await api("/api/stats")}catch(e){}
if(k!=TK)return;var total=u.prem?p.qn:p.free,plan=u.plan||45,goal=Math.max(5,Math.min(100,Math.ceil((total||0)/plan))),ed=u.exam_date||p.examDate,left=null;if(ed){left=Math.ceil((new Date(ed+"T00:00:00")-Date.now())/864e5)}
var g=grp(),ks=Object.keys(g),WD=["রবি","সোম","মঙ্গল","বুধ","বৃহ","শুক্র","শনি"],pct=Math.min(100,Math.round(st.today/goal*100));
m.innerHTML='<div class="card"><div class="row" style="align-items:center;flex-wrap:nowrap"><span class="av" style="width:56px;height:56px;font-size:1.5rem;background:'+AVC[u.avatar%AVC.length]+';flex:none">'+esc(u.name.charAt(0).toUpperCase())+'</span><div style="flex:1;min-width:0"><h2 style="margin:0">স্বাগতম, '+esc(u.name)+'</h2><div class="m">রোল: '+esc(u.roll)+' · <span class="pill '+(u.prem?'fr':'lk')+'">'+(u.prem?'প্রিমিয়াম':'ফ্রি ট্রায়াল')+'</span></div></div></div><div class="m" style="margin-top:8px">লক্ষ্য: <b style="color:var(--t)">'+esc([u.body,u.grade,u.track].filter(Boolean).join(" · ")||"এখনো বাছাই করা হয়নি")+'</b> <a href="#" onclick="profile();return false" style="color:var(--p)">(পরিবর্তন)</a></div>'+(u.prem?'':'<div class="card" style="background:var(--pl);box-shadow:none"><div>'+ic("lock",18)+' আপনি এখন <b>'+bn(p.free||0)+'টি ফ্রি প্রশ্ন ও ফ্রি মডেল টেস্ট</b> পাচ্ছেন। একবারের ফি দিয়ে সব প্রশ্ন ও সব মডেল টেস্ট আনলক করুন।</div><br><button class="btn wide" onclick="tab(\'pass\')">৳'+price()+' টাকায় আনলক করুন</button></div>')+'</div>'+
(p.notice?'<div class="card warn">'+ic("alert",18)+' '+esc(p.notice)+'</div>':'')+
(left!=null?'<div class="card" style="background:var(--pl);border-color:#bfd0ff"><div class="row" style="align-items:center;flex-wrap:nowrap"><div style="flex:1"><b>'+(u.exam_date?'আপনার পরীক্ষার তারিখ পর্যন্ত বাকি':esc(p.examName||'পরীক্ষার আনুমানিক তারিখ পর্যন্ত বাকি'))+'</b><div class="m">'+esc(ed)+'</div></div><div class="tc" style="flex:none"><div class="big">'+bn(Math.max(0,left))+'</div><div class="m">দিন বাকি</div></div></div></div>':'<div class="card m">পরীক্ষার তারিখ জানা থাকলে <a href="#" onclick="profile();return false" style="color:var(--p)">প্রোফাইলে যোগ করুন</a>, কাউন্টডাউন দেখতে পাবেন।</div>')+
'<div class="card"><div class="row" style="align-items:center;flex-wrap:nowrap"><span class="logo" style="background:var(--pl);color:var(--p)">'+ic("star",22)+'</span><div><h3 style="margin:0">আজকের দৈনিক লক্ষ্য</h3><div class="m">লক্ষ্য: দৈনিক '+bn(goal)+'টি প্রশ্ন'+(st.today<goal?' — আর '+bn(goal-st.today)+'টি বাকি':' — ✅ আজকের লক্ষ্য পূর্ণ!')+'</div></div></div><button class="btn wide" style="margin:12px 0" onclick="tab(\'practice\')">'+ic("play",18)+' অনুশীলন শুরু করুন</button><div class="row m"><div>আজকের সমাপ্তি</div><div style="text-align:right"><b style="color:var(--t)">'+bn(st.today)+' / '+bn(goal)+' প্রশ্ন ('+bn(pct)+'%)</b></div></div><div class="bar" style="margin:6px 0 14px"><i style="width:'+pct+'%"></i></div><div class="m"><b>সিলেবাস শেষ করার সময়সীমা:</b></div><div class="chips">'+[[15,"ক্র্যাশ"],[30,"তীব্র"],[45,"প্রস্তাবিত"],[60,"ধীরস্থির"],[90,"ফাউন্ডেশন"]].map(function(x){return'<button class="'+(plan==x[0]?'on':'')+'" onclick="setPlan('+x[0]+')">'+bn(x[0])+' দিন ('+x[1]+')</button>'}).join("")+'</div></div>'+
'<div class="card"><div class="kpi"><div><span style="color:#f08a00">'+ic("flame",26)+'</span><b>'+bn(st.streak)+'</b><span class="m">দিনের স্ট্রিক</span></div><div><b>'+bn(u.pts)+'</b><span class="m">মোট পয়েন্ট</span></div><div><b>'+bn(st.total)+'</b><span class="m">মোট উত্তর</span></div><div><b style="color:var(--ok)">'+bn(st.total?Math.round(st.correct/st.total*100):0)+'%</b><span class="m">সঠিকের হার</span></div></div></div>'+
'<div class="card"><h3>'+ic("cal",18)+' এই সপ্তাহের ধারাবাহিকতা</h3><div class="m">বিগত ৭ দিনের হিসাব</div><div class="days">'+st.last7.map(function(d,i){var wd=WD[new Date(d.day+"T00:00:00Z").getUTCDay()];return'<div><span>'+wd+'</span><div class="dc'+(i==6?' t':'')+'">'+bn(+d.day.slice(8))+'</div><div class="dot'+(d.n>=goal?' g':d.n>0?' h':'')+'"></div></div>'}).join("")+'</div><div class="m">🟢 লক্ষ্য পূর্ণ &nbsp; 🔵 অনুশীলন হয়েছে &nbsp; ⚪ হয়নি</div></div>'+
(ks.length?'<div class="card"><h3>'+ic("layers",18)+' বিষয়ভিত্তিক দৈনিক লক্ষ্য ('+bn(plan)+' দিনের টার্গেটে)</h3>'+ks.map(function(k,i){var acc=u.prem?g[k].n:g[k].f;return'<div class="row" style="align-items:center;flex-wrap:nowrap;border-top:1px solid var(--b);padding:9px 0"><b class="m" style="width:22px">'+bn(i+1)+'</b><div style="flex:1;min-width:0"><b>'+esc(k)+'</b> <span class="pill fr">দৈনিক ~'+bn(Math.ceil(acc/plan))+'টি</span><div class="m">'+(u.prem?'':'ফ্রি: ')+bn(acc)+'টি প্রশ্ন'+(u.prem?'':' • পূর্ণাঙ্গ: '+bn(g[k].n)+'টি')+'</div></div><button class="btn g sm" data-k="'+esc(k)+'" onclick="PR.s=this.dataset.k;PR.topic=\'\';tab(\'practice\')">'+ic("play",18)+'</button></div>'}).join("")+'</div>':'')+footer(true)}
async function setPlan(n){try{var r=await api("/api/profile",{plan:n,name:S.u.name,avatar:S.u.avatar,body:S.u.body,grade:S.u.grade,track:S.u.track,exam_date:S.u.exam_date});S.u=r.user;tHome()}catch(e){toast(e.error||"সমস্যা হয়েছে")}}
/* ---------- মডেল টেস্ট ---------- */
var TF="";
async function tTests(){var m=$("main"),k=TK;if(E){sheet();return}var l=ls("last");if(l){showRes(l);return}m.innerHTML=LD;await refreshMe();
try{var T=await api("/api/tests"),M=await api("/api/my/tests");if(k!=TK)return;window._T=T;var bs=[];T.forEach(function(t){if(t.body&&bs.indexOf(t.body)<0)bs.push(t.body)});
m.innerHTML='<div class="card" style="background:var(--pl)"><h2>'+ic("zap",20)+' মডেল টেস্ট</h2><div class="m">সময় ধরে পূর্ণাঙ্গ পরীক্ষা দিন, নেগেটিভ মার্কিংসহ। শেষে সঠিক উত্তর, ব্যাখ্যা ও র‍্যাংক দেখুন।</div></div>'+(bs.length?'<div class="chips"><button class="'+(!TF?'on':'')+'" onclick="TF=\'\';tTests()">সব</button>'+bs.map(function(b){return'<button class="'+(TF==b?'on':'')+'" data-b="'+esc(b)+'" onclick="TF=this.dataset.b;tTests()">'+esc(b)+'</button>'}).join("")+'</div>':'')+
(T.filter(function(t){return!TF||t.body==TF}).map(function(t){return'<div class="card"><h3>'+esc(t.title)+'</h3><div>'+(t.body?'<span class="pill">'+esc(t.body)+'</span>':'')+(t.grade?'<span class="pill">'+esc(t.grade)+'</span>':'')+(t.track?'<span class="pill">'+esc(t.track)+'</span>':'')+(t.free?'<span class="pill fr">ফ্রি</span>':'<span class="pill lk">পাস দরকার</span>')+'</div><div class="m">'+bn(t.n)+'টি প্রশ্ন · '+bn(t.mins)+' মিনিট · ভুলে −'+bn(t.neg)+' নম্বর</div>'+(t.done?'<div class="m">আপনার সর্বশেষ ফল: <b style="color:var(--t)">'+bn(t.done.score)+' / '+bn(t.done.n)+'</b> · <a href="#" style="color:var(--p)" onclick="showRes(\''+t.done.id+'\');return false">উত্তর দেখুন</a></div>':'')+'<br>'+(t.locked?'<button class="btn g wide" onclick="tab(\'pass\')">'+ic("lock",16)+' পাস নিয়ে আনলক করুন</button>':'<button class="btn wide" onclick="startTest(\''+t.id+'\')">'+(t.done?'আবার পরীক্ষা দিন':'পরীক্ষা শুরু করুন')+'</button>')+'</div>'}).join("")||'<div class="card m tc">এখন কোনো মডেল টেস্ট নেই। শীঘ্রই যুক্ত হবে।</div>')+
(M.length?'<h2 style="margin-top:20px">আপনার পূর্বের ফলাফল</h2>'+M.map(function(r){return'<div class="card"><b>'+esc(r.title||"পরীক্ষা")+'</b> <span class="m">'+new Date(r.submitted).toLocaleString("bn-BD")+'</span><br>স্কোর <b>'+bn(r.score)+' / '+bn(r.n)+'</b> <button class="btn g sm" style="float:right" onclick="showRes(\''+r.id+'\')">উত্তর দেখুন</button></div>'}).join(""):'')}catch(e){m.innerHTML='<div class="card nob">'+esc(e.error||"লোড করা যায়নি")+'</div>'}}
async function startTest(id){try{var d=await api("/api/test/start",{testId:id});E={aid:d.aid,qs:d.qs,ans:{},end:Date.now()+(d.started+d.mins*60000-d.now),title:d.title};sv();sheet()}catch(e){if(e.locked){toast("এই মডেল টেস্ট দিতে পাস দরকার");tab("pass")}else toast(e.error||"শুরু করা যায়নি")}}
function sv(){lw("cur",JSON.stringify(E))}
function sheet(){var m=$("main");document.body.classList.add("ex");window.scrollTo(0,0);m.innerHTML='<div class="top2"><span>⏱ <span id="tt"></span></span><span class="m" id="ct"></span><button class="btn sm" onclick="ask()">জমা দিন</button></div><div class="bar" style="margin:6px 0"><i id="pb"></i></div><div id="cf"></div><h2>'+esc(E.title||"")+'</h2>'+E.qs.map(function(q,i){return'<div class="card q"><div class="qh"><span class="tag">প্রশ্ন '+bn(i+1)+'</span></div><div class="qt">'+esc(q.q)+'</div>'+q.o.map(function(o,j){return'<button class="op'+(E.ans[q.id]===j?' sel':'')+'" id="o'+i+'_'+j+'" onclick="pickT('+i+','+j+')"><i>('+"কখগঘ"[j]+')</i><span>'+esc(o)+'</span></button>'}).join("")+'</div>'}).join("")+'<button class="btn wide" onclick="ask()">জমা দিন</button><br><br>';cn2();clearInterval(tm);tm=setInterval(tick,1000);tick()}
function cn2(){var d=0;E.qs.forEach(function(q){if(E.ans[q.id]!=null)d++});$("ct").textContent=bn(d)+"/"+bn(E.qs.length)+" উত্তর";$("pb").style.width=d/E.qs.length*100+"%"}
function pickT(i,j){var q=E.qs[i];if(E.ans[q.id]===j)delete E.ans[q.id];else E.ans[q.id]=j;for(var k=0;k<4;k++)$("o"+i+"_"+k).className="op"+(E.ans[q.id]===k?" sel":"");cn2();sv()}
function tick(){if(!E)return;var t=Math.max(0,Math.round((E.end-Date.now())/1000)),el=$("tt");if(el)el.textContent=bn(Math.floor(t/60))+":"+bn(("0"+t%60).slice(-2));if(t<=0)finish()}
function ask(){var d=0;E.qs.forEach(function(q){if(E.ans[q.id]!=null)d++});var u=E.qs.length-d,c=$("cf");c.innerHTML='<div class="card warn">'+(u?bn(u)+'টি প্রশ্নের উত্তর দেওয়া হয়নি। ':'')+'জমা দিবেন?<br><br><div class="row"><button class="btn" onclick="finish()">হ্যাঁ, জমা দিন</button><button class="btn g" onclick="document.getElementById(\'cf\').innerHTML=\'\'">না, ফিরে যাই</button></div></div>';c.scrollIntoView({block:"center"})}
async function finish(){if(!E||sending)return;sending=true;clearInterval(tm);var id=E.aid;try{var r=await api("/api/test/submit",{aid:id,answers:E.ans});E=null;sending=false;lw("cur",null);lw("last",r.aid);resView(r)}catch(e){sending=false;if(e&&e.done){E=null;lw("cur",null);showRes(id);return}toast((e&&e.error)||"জমা দেওয়া যায়নি, আবার চেষ্টা করুন");if(E){clearInterval(tm);tm=setInterval(tick,1000)}}}
async function showRes(aid){lw("last",aid);S.tab="tests";lw("tab","tests");var m=$("main"),k=TK;if(m)m.innerHTML=LD;try{var rr=await api("/api/test/result?aid="+encodeURIComponent(aid));if(k!=TK)return;resView(rr)}catch(e){if(k!=TK)return;lw("last",null);toast((e&&e.error)||"ফলাফল পাওয়া যায়নি");tab("tests")}}
function resView(r){document.body.classList.remove("ex");window.scrollTo(0,0);var nb='<button class="btn wide" onclick="lw(\'last\',null);tab(\'tests\')">'+ic("zap",18)+' নতুন পরীক্ষা দিন</button>';
$("main").innerHTML='<div class="card tc"><div class="m">'+esc(r.title||"")+'</div><div class="m">আপনার স্কোর</div><div class="big">'+bn(r.score)+' / '+bn(r.n)+'</div><p>✅ সঠিক '+bn(r.c)+' &nbsp; ❌ ভুল '+bn(r.w)+' &nbsp; ⏭ বাদ '+bn(r.sk)+'<br><span class="m">প্রতি ভুলে −'+bn(r.neg)+' নম্বর কাটা হয়েছে</span></p><div class="pill">'+ic("award",14)+' অবস্থান: '+bn(r.rank)+' / '+bn(r.total)+' জন</div></div>'+nb+'<br>'+
r.review.map(function(q,i){return'<div class="card q"><div class="qh"><span class="tag">প্রশ্ন '+bn(i+1)+'</span>'+(q.pick<0?'<span class="pill lk">বাদ দিয়েছেন</span>':q.pick==q.a?'<span class="pill fr">সঠিক</span>':'<span class="pill" style="background:var(--nol);color:var(--no)">ভুল</span>')+'</div><div class="qt">'+esc(q.q)+'</div>'+q.o.map(function(o,j){return'<div class="op'+(j==q.a?' ok':(j==q.pick?' no':''))+'"><i>('+"কখগঘ"[j]+')</i><span>'+esc(o)+(j==q.a?' ✓':'')+(j==q.pick&&j!=q.a?' ✗':'')+'</span></div>'}).join("")+'<div class="ex">💡 '+esc(q.e||"ব্যাখ্যা নেই")+'</div><div class="m" style="margin-top:6px">'+(q.s?'বিষয়: '+esc(q.s):'')+(q.src?' · সূত্র: '+esc(q.src):'')+'</div></div>'}).join("")+nb+'<br>'}
/* ---------- র‍্যাংক ---------- */
async function tRank(){var m=$("main"),k=TK;m.innerHTML=LD;await refreshMe();try{var r=await api("/api/leaderboard"),st=await api("/api/stats"),med=["🥇","🥈","🥉"];if(k!=TK)return;
m.innerHTML='<div class="card"><div class="row" style="align-items:center;flex-wrap:nowrap"><span class="logo" style="background:var(--aml);color:#d97706;flex:none">'+ic("award",24)+'</span><div><h2 style="margin:0">লাইভ পরীক্ষার্থী র‍্যাংকিং ও পয়েন্ট বোর্ড</h2><div class="m">আপনার বর্তমান পয়েন্ট: <b style="color:#d97706">'+bn(S.u.pts)+'</b> • স্ট্রিক: <b>'+bn(st.streak)+' দিন</b>'+(r.mine?' • আপনার অবস্থান: <b>'+bn(r.mine.rank)+'</b>':'')+'</div></div></div>'+(S.u.prem?'':'<br><button class="btn wide" onclick="tab(\'pass\')">৳'+price()+' টাকায় আনলক করুন</button>')+'</div>'+
(r.rows.length?r.rows.map(function(x,i){return'<div class="rk '+(i<3?'r'+(i+1):'')+'"><div class="md">'+(i<3?med[i]:'#'+bn(i+1))+'</div><div style="min-width:0"><div class="nm">'+esc(x.name)+'</div><div class="m">'+esc(x.body||"পরীক্ষার্থী")+'</div></div><div class="pt">'+bn(x.pts)+'</div></div>'}).join(""):'<div class="card m tc">এখনো কেউ পয়েন্ট পায়নি। অনুশীলন শুরু করে প্রথম হোন!</div>')+
(r.locked?'<div class="lockbox"><div class="blur">'+[1,2,3].map(function(){return'<div class="rk"><div class="md">#৬</div><div><div class="nm">সংরক্ষিত নাম</div><div class="m">পরীক্ষার্থী</div></div><div class="pt">০০০</div></div>'}).join("")+'</div><div class="lb">'+ic("lock",26)+'<span>পূর্ণ র‍্যাংকিং দেখতে প্রিমিয়াম নিন</span></div></div>':'')}catch(e){m.innerHTML='<div class="card nob">'+esc(e.error||"লোড করা যায়নি")+'</div>'}}
/* ---------- পাস ---------- */
async function tPass(){var m=$("main"),k=TK;m.innerHTML=LD;await refreshMe();var u=S.u,p=S.pub||{},pay=p.pay||{},mine=[];try{mine=await api("/api/pay/mine")}catch(e){}if(k!=TK)return;
var until=u.premUntil>4e12?"আজীবন":new Date(u.premUntil).toLocaleDateString("bn-BD"),wa=String(p.wa||"").replace(/\D/g,""),ST={pending:"যাচাই চলছে",approved:"অনুমোদিত",rejected:"বাতিল"},MN={bkash:"বিকাশ",nagad:"নগদ",rocket:"রকেট",cash:"অন্যান্য"};
if(u.prem){m.innerHTML='<div class="card okb tc"><div style="color:var(--ok)">'+ic("crown",44)+'</div><h2>আপনার পাস সক্রিয় আছে</h2><div class="m">মেয়াদ: <b style="color:var(--t)">'+until+'</b></div><br><button class="btn wide" onclick="tab(\'practice\')">অনুশীলন শুরু করুন</button></div>'+footer(true);return}
var nums=[["bkash","বিকাশ"],["nagad","নগদ"],["rocket","রকেট"]].filter(function(x){return pay[x[0]]});
m.innerHTML='<div class="plan hot"><span class="tagp">সম্পূর্ণ অ্যাক্সেস পাস</span><b style="color:var(--p)">সম্পূর্ণ অ্যাক্সেস পাস</b><div class="price">৳'+price()+'</div><div class="m">একবার পেমেন্ট</div><ul><li>'+ic("ok",20)+'<span>সম্পূর্ণ '+bn(p.qn||0)+'+ ব্যাখ্যাসহ প্রশ্ন</span></li><li>'+ic("ok",20)+'<span>সব মডেল টেস্ট (বুয়েট/বিপিএসসি প্যাটার্ন)</span></li><li>'+ic("ok",20)+'<span>পূর্ণ র‍্যাংকিং ও পয়েন্ট বোর্ড</span></li><li>'+ic("ok",20)+'<span>ভুল প্রশ্নের স্মার্ট রিভিশন ব্যাংক</span></li></ul></div>'+
'<div class="card"><h3>পেমেন্ট করার নিয়ম</h3><ol style="padding-left:20px"><li>নিচের নম্বরে <b>৳'+price()+'</b> সেন্ড মানি করুন'+(nums.length?':':'।')+'</li></ol>'+(nums.length?nums.map(function(x){return'<div class="card" style="box-shadow:none;background:var(--bg);margin:6px 0"><b>'+x[1]+':</b> <span style="font-size:1.1rem;letter-spacing:.04em">'+esc(pay[x[0]])+'</span></div>'}).join(""):'<div class="m">পেমেন্টের নম্বর শীঘ্রই যুক্ত হবে। সাপোর্টে যোগাযোগ করুন।</div>')+'<ol start="2" style="padding-left:20px"><li>ট্রানজেকশন আইডি ও যে নম্বর থেকে পাঠিয়েছেন তা নিচে লিখে জমা দিন।</li><li>যাচাই শেষে আপনার অ্যাকাউন্টে পাস সক্রিয় হবে।</li></ol><label>পেমেন্ট মাধ্যম</label><select id="pm"><option value="bkash">বিকাশ</option><option value="nagad">নগদ</option><option value="rocket">রকেট</option><option value="cash">অন্যান্য</option></select><label>ট্রানজেকশন আইডি / রেফারেন্স *</label><input id="pt" placeholder="যেমন: 9A7K3XXXXX"><label>যে নম্বর থেকে পাঠিয়েছেন</label><input id="pp" type="tel" placeholder="01XXXXXXXXX"><button class="btn wide" onclick="sendPay()">পেমেন্ট জমা দিন</button></div>'+
(mine.length?'<div class="card"><h3>আপনার অনুরোধ</h3>'+mine.map(function(x){return'<div class="row m" style="padding:5px 0;border-top:1px solid var(--b)"><div>'+MN[x.method]+' · '+esc(x.trx)+'</div><div style="text-align:right"><b style="color:'+(x.status=="approved"?'var(--ok)':x.status=="rejected"?'var(--no)':'var(--am)')+'">'+ST[x.status]+'</b></div></div>'}).join("")+'</div>':'')+(wa?'<div class="card tc m">সাহায্য লাগলে হোয়াটসঅ্যাপে যোগাযোগ করুন: <a href="https://wa.me/'+wa+'" target="_blank" rel="noopener" style="color:var(--p)">+'+esc(wa)+'</a></div>':'')+footer(true)}
async function sendPay(){try{await api("/api/pay",{method:$("pm").value,trx:$("pt").value,phone:$("pp").value});toast("পেমেন্ট অনুরোধ জমা হয়েছে। যাচাই শেষে পাস সক্রিয় হবে।");tPass()}catch(e){toast(e.error||"সমস্যা হয়েছে")}}
/* ---------- অ্যাডমিন ---------- */
function admin(){if(!sessionStorage.getItem("ap")){V.innerHTML='<div class="w"><div class="card"><h2>🔒 অ্যাডমিন লগইন</h2><input id="pw" type="password" placeholder="পাসওয়ার্ড"><button class="btn wide" onclick="adLogin()">প্রবেশ</button></div></div>';return}
V.innerHTML='<div class="w"><h1>⚙️ অ্যাডমিন প্যানেল</h1><div class="tabs">'+[["adDash","ড্যাশবোর্ড"],["adQB","প্রশ্নভান্ডার"],["adMk","পরীক্ষা তৈরি"],["adExams","আমার পরীক্ষা"],["adPay","পেমেন্ট"],["adUsers","ইউজার"],["adSet","সেটিংস"]].map(function(x){return'<button class="btn g sm" onclick="'+x[0]+'()">'+x[1]+'</button>'}).join("")+'<button class="btn g sm" onclick="location.hash=\'\'">সাইট</button></div><div id="ad"></div></div>';adDash()}
async function adLogin(){sessionStorage.setItem("ap",$("pw").value);try{await api("/api/admin/login",{},true);admin()}catch(e){sessionStorage.removeItem("ap");toast("পাসওয়ার্ড ভুল")}}
async function aa(p,b){try{return await api(p,b,true)}catch(e){if(e.status==401){sessionStorage.removeItem("ap");admin()}throw e}}
async function adDash(){var a=$("ad");a.innerHTML=LD;try{var s=await aa("/api/admin/stats"),c=function(t,v,x){return'<div class="card tc" style="margin:4px"><div class="m">'+t+'</div><div class="big">'+bn(v)+'</div>'+(x?'<div class="m">'+x+'</div>':'')+'</div>'};
a.innerHTML='<div class="row">'+c("মোট ইউজার",s.users,"আজ নতুন "+bn(s.newToday))+c("প্রিমিয়াম ইউজার",s.prem)+c("মোট ভিজিটর",s.visitors,"গত ২৪ ঘণ্টায় "+bn(s.vToday))+c("প্রশ্নভান্ডার",s.qn)+'</div><div class="row">'+c("পরীক্ষা শুরু",s.started,"জমা "+bn(s.submitted))+c("অনুশীলনে উত্তর",s.answers)+c("পেন্ডিং পেমেন্ট",s.pending)+'</div><div class="card sc"><h3>সাম্প্রতিক পরীক্ষার্থী</h3><table class="t"><tr><th>নাম</th><th>পরীক্ষা</th><th>স্কোর</th><th>সঠিক/ভুল/বাদ</th><th>সময়</th></tr>'+s.list.map(function(r){return'<tr><td>'+esc(r.name)+'</td><td>'+esc(r.title||"-")+'</td><td>'+r.score+'/'+r.n+'</td><td>'+r.c+'/'+r.w+'/'+r.sk+'</td><td>'+new Date(r.submitted).toLocaleString("bn-BD")+'</td></tr>'}).join("")+'</table></div>'}catch(e){a.textContent=e.error||"ত্রুটি"}}
/* প্রশ্নভান্ডার */
function adQB(){var chk=function(id,l){return'<div class="chips" id="'+id+'" style="flex-wrap:wrap;overflow:visible">'+l.map(function(s){return'<label style="border:1.5px solid var(--b);border-radius:12px;padding:5px 12px;display:flex;gap:6px;align-items:center;color:var(--t);background:var(--c)"><input type="checkbox" value="'+esc(s)+'" style="width:auto;margin:0">'+esc(s)+'</label>'}).join("")+'</div>'};
$("ad").innerHTML='<div class="card"><h2>১) ট্যাগ (এই ব্যাচের সব প্রশ্নে বসবে)</h2><div class="row"><div><label>পরীক্ষার ধরন</label><select id="tg_b">'+opts(BODIES)+'</select></div><div><label>গ্রেড</label><select id="tg_g">'+opts(GRADES)+'</select></div><div><label>ধরন</label><select id="tg_t">'+opts(TRACKS)+'</select></div></div><label>সূত্র লেবেল (ঐচ্ছিক, যেমন: ৪৫তম বিসিএস)</label><input id="tg_s"><label style="display:flex;gap:8px;align-items:center;color:var(--t)"><input type="checkbox" id="tg_f" style="width:auto;margin:0"> এই ব্যাচের প্রশ্নগুলো ফ্রি (সবার জন্য খোলা) থাকবে</label></div>'+
'<div class="card"><h2>২) এআই দিয়ে প্রশ্ন তৈরি</h2><label>বিষয় (এক বা একাধিক)</label>'+chk("gs",SUBJ)+'<div class="row"><div><label>পরীক্ষার ধাঁচ</label><select id="gy">'+STY.map(function(s){return'<option>'+esc(s)+'</option>'}).join("")+'</select></div><div><label>কাঠিন্য</label><select id="gd"><option>মাঝারি</option><option selected>কঠিন</option><option>খুবই কঠিন (ক্রিটিক্যাল)</option></select></div><div><label>মোট প্রশ্ন</label><input id="gn" type="number" value="30"></div></div><label>ঐচ্ছিক: বিগত বছরের আসল কিছু প্রশ্ন (এআই এই ধাঁচে বানাবে)</label><textarea id="gr" rows="3"></textarea><button class="btn wide" id="gb" onclick="genq()">প্রশ্ন তৈরি করুন</button></div>'+
'<div class="card"><h2>৩) PDF থেকে বিগত প্রশ্ন সংগ্রহ</h2><div class="m">একটি পরীক্ষার (যেমন ৪৫তম বিসিএস) একটি PDF দিন (১০ MB-এর মধ্যে)। উত্তরমালা না থাকলে এআই নিজে সমাধান করে ⚠ চিহ্ন দেবে, আপনি যাচাই করবেন।</div><input id="pf" type="file" accept="application/pdf"><div class="row"><div><label>প্রশ্ন নং থেকে</label><input id="pa" type="number" value="1"></div><div><label>পর্যন্ত</label><input id="pz" type="number" value="200"></div></div><button class="btn wide" id="pb2" onclick="ext()">প্রশ্ন বের করুন</button></div>'+
'<div class="card"><h2>৪) JSON ইমপোর্ট / হাতে যোগ</h2><textarea id="ij" rows="3" placeholder=\'[{"s":"বাংলা","t":"সন্ধি","q":"প্রশ্ন","o":["ক","খ","গ","ঘ"],"a":0,"e":"ব্যাখ্যা"}]\'></textarea><button class="btn g wide" onclick="impq()">JSON ইমপোর্ট</button><hr style="border:0;border-top:1px solid var(--b);margin:14px 0"><div class="row"><div><label>বিষয়</label><select id="mq_s">'+opts(SUBJ)+'</select></div><div><label>টপিক</label><input id="mq_t"></div></div><label>প্রশ্ন</label><textarea id="mq_q" rows="2"></textarea><input id="mq_0" placeholder="(ক)"><input id="mq_1" placeholder="(খ)"><input id="mq_2" placeholder="(গ)"><input id="mq_3" placeholder="(ঘ)"><div class="row"><div><select id="mq_a"><option value="0">সঠিক: ক</option><option value="1">সঠিক: খ</option><option value="2">সঠিক: গ</option><option value="3">সঠিক: ঘ</option></select></div><div><input id="mq_e" placeholder="ছোট ব্যাখ্যা"></div></div><button class="btn g wide" onclick="manq()">খসড়ায় যোগ করুন</button></div><div id="dr"></div><div id="qb"></div>';drf();qbInfo()}
function tags(){return{body:$("tg_b").value,grade:$("tg_g").value,track:$("tg_t").value,src:$("tg_s").value,free:$("tg_f").checked}}
function drf(){var d=$("dr");if(!d)return;d.innerHTML='<div class="card"><h2>খসড়া ('+bn(D.length)+'টি প্রশ্ন)</h2><div class="m">সবুজ = সঠিক উত্তর। ভুল মনে হলে সঠিক অপশনে চাপ দিয়ে বদলান, বা ✕ দিয়ে বাদ দিন।</div></div>'+D.map(function(q,i){return'<div class="card q"><div class="m">'+esc(q.s||"বিষয় নেই")+(q.t?' · '+esc(q.t):'')+(q.src?' · '+esc(q.src):'')+'</div><div class="qt">'+(i+1)+'. '+esc(q.q)+'</div>'+q.o.map(function(o,j){return'<div class="op'+(j==q.a?' ok':'')+'" style="cursor:pointer" onclick="D['+i+'].a='+j+';D['+i+'].c=\'\';drf()"><i>('+"কখগঘ"[j]+')</i><span>'+esc(o)+'</span></div>'}).join("")+(q.c=="low"?'<div class="m" style="color:var(--no)">⚠ উত্তর যাচাই করুন (এআই নিশ্চিত নয়)</div>':'')+'<div class="m">💡 '+esc(q.e||"")+'</div>'+(q.s?'':'<select onchange="D['+i+'].s=this.value">'+opts(SUBJ)+'</select>')+'<button class="btn g sm" onclick="D.splice('+i+',1);drf()">✕ বাদ দিন</button></div>'}).join("")+(D.length?'<button class="btn wide" onclick="saveQ()">📚 ভান্ডারে সংরক্ষণ</button><br>':'')}
async function saveQ(){var miss=D.filter(function(q){return!q.s}).length;if(miss){toast("কিছু প্রশ্নে বিষয় বাছাই করা হয়নি ("+bn(miss)+"টি)");return}try{var r=await aa("/api/admin/qadd",{qs:D,tags:tags()});toast(bn(r.added)+"টি সংরক্ষিত"+(r.skipped?", "+bn(r.skipped)+"টি আগেই ছিল":""));D=[];drf();qbInfo()}catch(e){toast(e.error||"ত্রুটি")}}
async function genq(){var ss=[].slice.call(document.querySelectorAll("#gs input:checked")).map(function(x){return x.value});if(!ss.length){toast("কমপক্ষে একটি বিষয় বেছে নিন");return}
var total=Math.max(1,Math.min(300,+$("gn").value||10)),b=$("gb"),done=0,fail=0,last="",base=Math.floor(total/ss.length),extra=total%ss.length;b.disabled=true;
for(var k=0;k<ss.length&&fail<4;k++){var need=base+(k<extra?1:0),sk=ss[k];
 while(need>0&&fail<4){var n=Math.min(need,8);b.textContent="এআই তৈরি করছে… "+bn(done)+"/"+bn(total)+" ("+sk+")";
  try{var avoid=D.filter(function(x){return x.s==sk}).slice(-30).map(function(x){return x.q.slice(0,50)});
   var r=await aa("/api/admin/generate",{subject:sk,style:$("gy").value,difficulty:$("gd").value,n:n,refs:$("gr").value,src:$("tg_s").value,avoid:avoid});
   if(!r.qs.length)throw{error:"এআই ফাঁকা উত্তর দিয়েছে"};D=D.concat(r.qs);done+=r.qs.length;need-=Math.max(1,r.qs.length);drf()}catch(e){fail++;last=(e&&e.error)||"";await new Promise(function(z){setTimeout(z,2500)})}
  await new Promise(function(z){setTimeout(z,800)})}}
b.disabled=false;b.textContent="প্রশ্ন তৈরি করুন";toast(bn(done)+"টি প্রশ্ন খসড়ায় যোগ হলো"+(fail?" — "+bn(fail)+" বার ব্যর্থ: "+last.slice(0,100):""))}
function b64(f){return new Promise(function(res,rej){var r=new FileReader();r.onload=function(){res(String(r.result).split(",")[1])};r.onerror=rej;r.readAsDataURL(f)})}
async function ext(){var f=$("pf").files[0];if(!f){toast("PDF বেছে নিন");return}if(f.size>11e6){toast("PDF ১০ MB-এর বেশি বড়, ভাগ করে দিন");return}var b=$("pb2"),data;b.disabled=true;b.textContent="ফাইল পড়া হচ্ছে…";
try{data=await b64(f)}catch(x){toast("ফাইল পড়া যায়নি");b.disabled=false;return}
var a=+$("pa").value||1,z=+$("pz").value||200,got=0,empty=0,fail=0;
for(var s=a;s<=z&&empty<2&&fail<3;s+=20){var e2=Math.min(s+19,z);b.textContent="বের হচ্ছে… প্রশ্ন "+bn(s)+"–"+bn(e2)+" ("+bn(got)+"টি পাওয়া গেছে)";
 try{var r=await aa("/api/admin/extract",{pdf:data,from:s,to:e2,src:$("tg_s").value,subjects:SUBJ});if(r.qs.length){empty=0;D=D.concat(r.qs);got+=r.qs.length;drf()}else empty++}catch(x){fail++}}
b.disabled=false;b.textContent="প্রশ্ন বের করুন";toast(bn(got)+"টি প্রশ্ন পাওয়া গেছে"+(fail?" ("+bn(fail)+" বার ব্যর্থ)":""))}
function impq(){try{var a=JSON.parse($("ij").value);a=a.filter(function(x){return x&&x.q&&x.o&&x.o.length==4&&Number.isInteger(x.a)});D=D.concat(a);toast(bn(a.length)+"টি খসড়ায় যোগ হলো");drf()}catch(e){toast("JSON ঠিক নেই")}}
function manq(){var o=[0,1,2,3].map(function(i){return $("mq_"+i).value.trim()}),q=$("mq_q").value.trim();if(!q||o.some(function(x){return!x})){toast("প্রশ্ন ও চারটি অপশন লিখুন");return}D.push({q:q,o:o,a:+$("mq_a").value,e:$("mq_e").value,s:$("mq_s").value,t:$("mq_t").value});["q","0","1","2","3","e"].forEach(function(k){$("mq_"+k).value=""});drf()}
async function qbInfo(){var b=$("qb");if(!b)return;try{var s=await aa("/api/admin/qstats"),t=0;s.forEach(function(x){t+=x.c});
b.innerHTML='<div class="card sc"><h2>ভান্ডারে মোট '+bn(t)+'টি প্রশ্ন</h2><table class="t"><tr><th>বিষয়</th><th>মোট</th><th>ফ্রি</th></tr>'+s.map(function(x){return'<tr><td>'+esc(x.s||"-")+'</td><td>'+bn(x.c)+'</td><td>'+bn(x.f||0)+'</td></tr>'}).join("")+'</table><br><div class="row"><div><select id="fs">'+opts(s.map(function(x){return x.s}),"","বিষয়")+'</select></div><div><input id="fn" type="number" value="10"></div><div><button class="btn g" onclick="mkFree()">এলোমেলো কয়টি ফ্রি করুন</button></div></div></div><div class="card"><h3>প্রশ্ন খুঁজুন / মুছুন</h3><div class="row"><div><input id="ls" placeholder="সার্চ…" oninput="qlist()"></div><div><select id="lf" onchange="qlist()">'+opts(s.map(function(x){return x.s}),"","সব বিষয়")+'</select></div></div><div id="qlr"></div></div>';qlist()}catch(e){}}
async function mkFree(){var s=$("fs").value;if(!s){toast("বিষয় বাছুন");return}try{await aa("/api/admin/qfree",{s:s,n:+$("fn").value});toast("ফ্রি করা হয়েছে");qbInfo()}catch(e){toast(e.error||"ত্রুটি")}}
async function qlist(){var r=await aa("/api/admin/qlist?s="+encodeURIComponent($("lf").value)+"&search="+encodeURIComponent($("ls").value));$("qlr").innerHTML='<div class="m">মোট '+bn(r.total)+'টি (সর্বশেষ ২০টি)</div>'+r.rows.map(function(x){return'<div class="card" style="box-shadow:none;margin:6px 0"><div class="m">'+esc(x.s)+(x.topic?' · '+esc(x.topic):'')+' <span class="pill '+(x.free?'fr':'lk')+'">'+(x.free?'ফ্রি':'পেইড')+'</span></div><div>'+esc(x.q)+'</div><div class="m">উত্তর: '+esc(x.o[x.a])+'</div><div class="row" style="margin-top:6px"><button class="btn g sm" onclick="qf(\''+x.id+'\','+(x.free?0:1)+')">'+(x.free?'পেইড করুন':'ফ্রি করুন')+'</button><button class="btn g sm" id="qd'+x.id+'" onclick="qd(\''+x.id+'\')">মুছুন</button></div></div>'}).join("")}
async function qf(id,f){await aa("/api/admin/qfree",{id:id,free:f});qlist();qbInfo()}
async function qd(id){var b=$("qd"+id);if(b.dataset.s!="1"){b.dataset.s="1";b.textContent="নিশ্চিত?";return}await aa("/api/admin/qdel",{id:id});qlist();qbInfo()}
/* পরীক্ষা তৈরি */
function adMk(){$("ad").innerHTML='<div class="card"><h2>নতুন মডেল টেস্ট</h2><label>পরীক্ষার নাম *</label><input id="mt" placeholder="যেমন: বুয়েট প্যাটার্ন মডেল টেস্ট ১"><div class="row"><div><label>সময় (মিনিট)</label><input id="mm" type="number" value="60"></div><div><label>ভুলে কাটা নম্বর</label><input id="mn" type="number" step="0.05" value="0.25"></div><div><label>মোট প্রশ্ন</label><input id="mc" type="number" value="50"></div></div><div class="row"><div><label>পরীক্ষার ধরন (ট্যাগ ও ফিল্টার)</label><select id="mb">'+opts(BODIES,"","যেকোনো")+'</select></div><div><label>গ্রেড</label><select id="mg">'+opts(GRADES,"","যেকোনো")+'</select></div><div><label>ধরন</label><select id="mk">'+opts(TRACKS,"","যেকোনো")+'</select></div></div><label>বিষয় (খালি রাখলে সব বিষয় থেকে এলোমেলো)</label><div class="chips" id="ms" style="flex-wrap:wrap;overflow:visible">'+SUBJ.map(function(s){return'<label style="border:1.5px solid var(--b);border-radius:12px;padding:5px 12px;display:flex;gap:6px;align-items:center;color:var(--t);background:var(--c)"><input type="checkbox" value="'+esc(s)+'" style="width:auto;margin:0">'+esc(s)+'</label>'}).join("")+'</div><label style="display:flex;gap:8px;align-items:center;color:var(--t)"><input type="checkbox" id="mf" style="width:auto;margin:0"> এটি ফ্রি মডেল টেস্ট (সবার জন্য খোলা)</label><label style="display:flex;gap:8px;align-items:center;color:var(--t)"><input type="checkbox" id="mx" checked style="width:auto;margin:0"> প্রশ্ন মিশিয়ে এলোমেলো করুন</label><label style="display:flex;gap:8px;align-items:center;color:var(--t)"><input type="checkbox" id="mo" style="width:auto;margin:0"> শুধু ফ্রি প্রশ্ন থেকে বাছুন</label><br><button class="btn wide" onclick="mkTest()">পরীক্ষা তৈরি ও প্রকাশ করুন</button></div>'}
async function mkTest(){var ss=[].slice.call(document.querySelectorAll("#ms input:checked")).map(function(x){return x.value});try{var r=await aa("/api/admin/test/create",{title:$("mt").value,mins:+$("mm").value,neg:+$("mn").value,n:+$("mc").value,body:$("mb").value,grade:$("mg").value,track:$("mk").value,subjects:ss,free:$("mf").checked,mix:$("mx").checked,onlyFree:$("mo").checked});toast("পরীক্ষা তৈরি হয়েছে ("+bn(r.n)+"টি প্রশ্ন)");adExams()}catch(e){toast(e.error||"ত্রুটি")}}
async function adExams(){var a=$("ad");a.innerHTML=LD;var L=await aa("/api/admin/tests");a.innerHTML=L.length?L.map(function(t,i){return'<div class="card"><b>'+esc(t.title)+'</b> <span class="m">'+(t.open?'🟢 চালু':'⚪ বন্ধ')+'</span><div>'+(t.body?'<span class="pill">'+esc(t.body)+'</span>':'')+(t.grade?'<span class="pill">'+esc(t.grade)+'</span>':'')+(t.track?'<span class="pill">'+esc(t.track)+'</span>':'')+'<span class="pill '+(t.free?'fr':'lk')+'">'+(t.free?'ফ্রি':'পেইড')+'</span></div><div class="m">'+bn(t.n)+'টি প্রশ্ন · '+bn(t.mins)+' মিনিট · ভুলে −'+bn(t.neg)+' · শুরু '+bn(t.at)+' · জমা '+bn(t.sb)+'</div><div class="row" style="margin-top:8px"><button class="btn g sm" onclick="tgo(\''+t.id+'\','+(t.open?0:1)+')">'+(t.open?'বন্ধ করুন':'চালু করুন')+'</button><button class="btn g sm" onclick="tfr(\''+t.id+'\','+(t.free?0:1)+')">'+(t.free?'পেইড করুন':'ফ্রি করুন')+'</button><button class="btn g sm" onclick="rs(\''+t.id+'\')">📊 ফলাফল</button><button class="btn g sm" id="td'+i+'" onclick="tdl(\''+t.id+'\','+i+')">মুছুন</button></div></div>'}).join(""):'<div class="card m">কোনো পরীক্ষা নেই।</div>'}
async function tgo(id,o){await aa("/api/admin/test/toggle",{id:id,open:o});adExams()}
async function tfr(id,f){await aa("/api/admin/test/free",{id:id,free:f});adExams()}
async function tdl(id,i){var b=$("td"+i);if(b.dataset.s!="1"){b.dataset.s="1";b.textContent="নিশ্চিত?";return}await aa("/api/admin/test/delete",{id:id});adExams()}
async function rs(id){var a=$("ad");a.innerHTML=LD;try{var r=await aa("/api/admin/test/results",{id:id}),rows=r.rows,sc=rows.map(function(x){return x.score}),avg=sc.length?Math.round(sc.reduce(function(p,c){return p+c},0)/sc.length*100)/100:0;
a.innerHTML='<button class="btn g sm" onclick="adExams()">← তালিকা</button><div class="card"><h2>'+esc(r.title)+'</h2><div class="m">মোট '+bn(r.n)+'টি প্রশ্ন</div><div class="row"><div><div class="m">জমা দিয়েছে</div><b>'+bn(rows.length)+'</b> (শুরু '+bn(r.started)+')</div><div><div class="m">সর্বোচ্চ</div><b>'+(rows.length?bn(rows[0].score):"-")+'</b></div><div><div class="m">গড়</div><b>'+bn(avg)+'</b></div><div><div class="m">সর্বনিম্ন</div><b>'+(rows.length?bn(rows[rows.length-1].score):"-")+'</b></div></div>'+(rows.length?'<p>🥇 সর্বোচ্চ নম্বর: <b>'+esc(rows[0].name)+'</b> ('+bn(rows[0].score)+'/'+bn(rows[0].n)+')</p>':'')+'</div><div class="card sc"><table class="t"><tr><th>#</th><th>নাম</th><th>ইমেইল</th><th>স্কোর</th><th>সঠিক/ভুল/বাদ</th><th>সময়</th></tr>'+rows.map(function(x,i){return'<tr><td>'+bn(i+1)+'</td><td>'+esc(x.name)+'</td><td>'+esc(x.email)+'</td><td>'+bn(x.score)+'/'+bn(x.n)+'</td><td>'+x.c+'/'+x.w+'/'+x.sk+'</td><td>'+bn(Math.round((x.submitted-x.started)/6000)/10)+' মি.</td></tr>'}).join("")+'</table></div>'}catch(e){a.textContent=(e&&e.error)||"ত্রুটি"}}
/* পেমেন্ট, ইউজার, সেটিংস */
async function adPay(){var a=$("ad");a.innerHTML=LD;var L=await aa("/api/admin/pay"),MN={bkash:"বিকাশ",nagad:"নগদ",rocket:"রকেট",cash:"অন্যান্য"},ST={pending:"পেন্ডিং",approved:"অনুমোদিত",rejected:"বাতিল"};
a.innerHTML='<div class="card"><h3>ইমেইল দিয়ে সরাসরি পাস দিন / বাতিল করুন</h3><div class="row"><div><input id="ge" type="email" placeholder="ইউজারের ইমেইল"></div><div><input id="gd2" type="number" value="36500" title="দিন"></div></div><div class="row"><button class="btn sm" onclick="grant(0)">পাস দিন (দিন)</button><button class="btn g sm" onclick="grant(1)">পাস বাতিল</button></div><div class="m">৩৬৫০০ দিন = আজীবন</div></div>'+(L.length?L.map(function(x){return'<div class="card"><b>'+esc(x.name)+'</b> <span class="m">'+esc(x.email)+'</span><div>'+MN[x.method]+' · <b>'+esc(x.trx)+'</b>'+(x.phone?' · '+esc(x.phone):'')+'</div><div class="m">'+new Date(x.created).toLocaleString("bn-BD")+' · <b style="color:'+(x.status=="pending"?'var(--am)':x.status=="approved"?'var(--ok)':'var(--no)')+'">'+ST[x.status]+'</b></div>'+(x.status=="pending"?'<div class="row" style="margin-top:8px"><button class="btn sm" onclick="payAct(\''+x.id+'\',\'approve\')">✅ অনুমোদন</button><button class="btn g sm" onclick="payAct(\''+x.id+'\',\'reject\')">বাতিল</button></div>':'')+'</div>'}).join(""):'<div class="card m">কোনো পেমেন্ট অনুরোধ নেই।</div>')}
async function payAct(id,act){try{await aa("/api/admin/pay/act",{id:id,action:act});toast("সম্পন্ন");adPay()}catch(e){toast(e.error||"ত্রুটি")}}
async function grant(rv){try{await aa("/api/admin/grant",{email:$("ge").value,days:+$("gd2").value,revoke:rv});toast("সম্পন্ন");adPay()}catch(e){toast(e.error||"ত্রুটি")}}
async function adUsers(){var a=$("ad");a.innerHTML='<div class="card"><input id="us" placeholder="নাম বা ইমেইল দিয়ে খুঁজুন" oninput="usl()"></div><div id="ul"></div>';usl()}
var ut=null;function usl(){clearTimeout(ut);ut=setTimeout(async function(){var r=await aa("/api/admin/users?search="+encodeURIComponent($("us").value));$("ul").innerHTML='<div class="card sc"><table class="t"><tr><th>নাম</th><th>ইমেইল</th><th>লক্ষ্য</th><th>পয়েন্ট</th><th>পাস</th></tr>'+r.map(function(x){return'<tr><td>'+esc(x.name)+'</td><td>'+esc(x.email)+'</td><td>'+esc(x.body||"-")+'</td><td>'+bn(x.pts)+'</td><td>'+(x.prem>Date.now()?"✅":"-")+'</td></tr>'}).join("")+'</table></div>'},250)}
async function adSet(){var s=await aa("/api/admin/settings",{}),F=[["price","পাসের দাম (টাকা)"],["days","পাসের মেয়াদ (দিন, ৩৬৫০০ = আজীবন)"],["ticker","উপরের নিউজ-স্ট্রিপের লেখা"],["tickerBadge","স্ট্রিপের ব্যাজ (যেমন: নতুন, ৭৫৩ পদ)"],["notice","হোম পেজের নোটিশ"],["examName","আনুমানিক পরীক্ষার নাম"],["examDate","আনুমানিক পরীক্ষার তারিখ (YYYY-MM-DD)"],["bkash","বিকাশ নম্বর"],["nagad","নগদ নম্বর"],["rocket","রকেট নম্বর"],["wa","হোয়াটসঅ্যাপ নম্বর (দেশের কোডসহ, যেমন 8801XXXXXXXXX)"]];
$("ad").innerHTML='<div class="card"><h2>সাইট সেটিংস</h2>'+F.map(function(f){return'<label>'+f[1]+'</label><input id="st_'+f[0]+'" value="'+esc(s[f[0]])+'">'}).join("")+'<button class="btn wide" onclick="saveSet()">সংরক্ষণ করুন</button></div>';window._F=F}
async function saveSet(){var o={};window._F.forEach(function(f){o[f[0]]=$("st_"+f[0]).value});try{await aa("/api/admin/settings",{set:o});toast("সংরক্ষিত হয়েছে")}catch(e){toast(e.error||"ত্রুটি")}}
boot();
</script></body></html>
`;
