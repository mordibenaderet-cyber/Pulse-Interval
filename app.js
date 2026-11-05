'use strict';

(() => {
  const PLAN_KEY = 'pulseIntervalPlansV1'; // Preserve all existing plans from versions 1 and 2.
  const HISTORY_KEY = 'pulseIntervalHistoryV3';
  const SETTINGS_KEY = 'pulseIntervalSettingsV3';
  const MAX_PLANS = 250;
  const MAX_STEPS = 2500;
  const MAX_DURATION = 12 * 60 * 60 * 1000;
  const byId = id => document.getElementById(id);
  const ico = (name, extra = '') => `<svg class="ic ${extra}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
  const uid = () => (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    ? crypto.randomUUID() : `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 11)}`;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const clone = value => JSON.parse(JSON.stringify(value));
  const safeId = value => typeof value === 'string' && /^[\w-]{4,90}$/.test(value) ? value : uid();
  const intBetween = (n, lo, hi) => Number.isInteger(n) && n >= lo && n <= hi;
  const formatTime = s => {
    const sec = Math.max(0, Math.ceil(s));
    const pad = n => String(n).padStart(2, '0');
    return sec >= 3600 ? `${pad(Math.floor(sec / 3600))}:${pad(Math.floor((sec % 3600)/60))}:${pad(sec % 60)}` : `${pad(Math.floor(sec / 60))}:${pad(sec % 60)}`;
  };
  const durationLabel = ms => formatTime(ms / 1000);
  const hDate = iso => new Date(iso).toLocaleDateString('he-IL', {day:'numeric',month:'long',year:'numeric'});
  const readJson = (key, fallback) => { try { const raw = localStorage.getItem(key); return raw === null ? fallback : JSON.parse(raw); } catch { return fallback; } };
  const writeJson = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { toast('האחסון המקומי אינו זמין. כדאי לייצא גיבוי.'); return false; } };

  function normalizePlan(p) {
    if (!p || typeof p !== 'object') return null;
    const result = {
      id: safeId(p.id),
      name: typeof p.name === 'string' ? p.name.trim() : '',
      warmup: p.warmup,
      rounds: p.rounds,
      roundRest: p.roundRest,
      exercises: Array.isArray(p.exercises) ? p.exercises.map(e => ({
        id: safeId(e?.id), name: typeof e?.name === 'string' ? e.name.trim() : '',
        work: e?.work, rest: e?.rest, sets: e?.sets
      })) : []
    };
    return validatePlan(result) ? result : null;
  }
  function validatePlan(p) {
    if (!p || typeof p.name !== 'string' || !p.name.trim() || p.name.length > 80) return false;
    if (!intBetween(p.warmup, 0, 3600) || !intBetween(p.rounds, 1, 100) || !intBetween(p.roundRest, 0, 3600)) return false;
    if (!Array.isArray(p.exercises) || p.exercises.length < 1 || p.exercises.length > 100) return false;
    if (!p.exercises.every(e => typeof e.name === 'string' && e.name.trim() && e.name.length <= 80 && intBetween(e.work,1,3600) && intBetween(e.rest,0,3600) && intBetween(e.sets,1,100))) return false;
    const workCount = p.exercises.reduce((total, e) => total + e.sets, 0) * p.rounds;
    if (workCount * 2 + p.rounds > MAX_STEPS) return false;
    const ms = (p.warmup + p.rounds * p.exercises.reduce((total,e)=>total+(e.work+e.rest)*e.sets,0) + (p.rounds-1)*p.roundRest)*1000;
    return ms > 0 && ms <= MAX_DURATION;
  }
  function newExercise(name = 'תרגיל חדש', work = 30, rest = 15, sets = 3) {
    return {id:uid(), name, work, rest, sets};
  }
  function makePreset(kind) {
    const data = {
      tabata: {name:'טאבטה קלאסית',warmup:5,rounds:1,roundRest:0,exercises:[newExercise('טאבטה • עבודה אינטנסיבית',20,10,8)]},
      hiit: {name:'HIIT אנרגטי',warmup:10,rounds:2,roundRest:45,exercises:[newExercise('Jumping Jacks',40,20,2),newExercise('סקוואטים',40,20,2),newExercise('Mountain Climbers',30,20,2)]},
      strength: {name:'אימון כוח',warmup:10,rounds:1,roundRest:0,exercises:[newExercise('שכיבות סמיכה',45,75,3),newExercise('סקוואט',45,75,3),newExercise('פלאנק',40,50,3)]},
      stretch: {name:'מתיחות ושחרור',warmup:5,rounds:1,roundRest:0,exercises:[newExercise('מתיחת רגליים',45,15,2),newExercise('מתיחת כתפיים',40,15,2),newExercise('מתיחת גב',45,10,2)]}
    }[kind];
    return data ? {...data,id:uid()} : null;
  }

  // Only the current, intended timing state is stored. A Date.now deadline, not
  // interval callback counts, determines the elapsed time. Late callbacks carry
  // excess elapsed time into every subsequent stage, preventing timer acceleration.
  function makeSteps(p) {
    const steps = [];
    if (p.warmup > 0) steps.push({type:'prepare',name:'מתכוננים לאימון',detail:'ההכנה מתחילה',duration:p.warmup*1000});
    for (let round = 1; round <= p.rounds; round++) {
      for (const e of p.exercises) {
        for (let set = 1; set <= e.sets; set++) {
          steps.push({type:'work',name:e.name,detail:`סבב ${round}/${p.rounds} · סט ${set}/${e.sets}`,duration:e.work*1000});
          // Rest is always after EACH set (including the last), exactly as
          // described in the editor and included in the displayed total.
          if (e.rest > 0) steps.push({type:'rest',name:'זמן מנוחה',detail:`אחרי ${e.name}`,duration:e.rest*1000});
        }
      }
      if (round < p.rounds && p.roundRest > 0) steps.push({type:'rest',name:'מנוחה בין סבבים',detail:`לפני סבב ${round+1}/${p.rounds}`,duration:p.roundRest*1000});
    }
    return steps;
  }
  const planMs = p => (p.warmup + p.rounds*p.exercises.reduce((sum,e)=>sum+(e.work+e.rest)*e.sets,0)+(p.rounds-1)*p.roundRest)*1000;

  let plans = [];
  const savedPlans = readJson(PLAN_KEY, null);
  if (Array.isArray(savedPlans)) plans = savedPlans.map(normalizePlan).filter(Boolean).slice(0, MAX_PLANS);
  else {
    plans = [makePreset('tabata'), makePreset('hiit'), makePreset('strength')];
    writeJson(PLAN_KEY, plans);
  }
  let history = readJson(HISTORY_KEY, []);
  if (!Array.isArray(history)) history = [];
  history = history.filter(h => h && typeof h.name === 'string' && Number.isFinite(h.seconds) && h.seconds >= 0 && !Number.isNaN(Date.parse(h.date))).slice(0, 500);
  let settings = readJson(SETTINGS_KEY, {sound:readJson('pulseSound',true) !== false, wakeLock:true});
  settings = {sound:settings?.sound !== false,wakeLock:settings?.wakeLock !== false};
  let page = 'home';
  let editor = null;
  let session = null;
  let intervalId = null;
  let audioContext = null;
  let wakeLock = null;
  let toastTimeout = null;

  function toast(message) {
    const el = byId('toast');
    el.textContent = message;
    el.classList.add('visible');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => el.classList.remove('visible'), 3700);
  }
  const persistPlans = () => writeJson(PLAN_KEY,plans);
  const persistHistory = () => writeJson(HISTORY_KEY,history);
  function navigate(next) {
    if (page === 'player' && next !== 'player' && session?.status === 'running') {
      if (!confirm('לצאת מהאימון הפעיל? ההתקדמות הנוכחית לא תישמר.')) return;
    }
    if (page === 'player' && next !== 'player') destroySession();
    page = next;
    byId('mainNav').hidden = (next === 'editor' || next === 'player');
    byId('appFooter').hidden = next === 'player';
    document.querySelectorAll('[data-page]').forEach(btn => {
      btn.classList.toggle('active',btn.dataset.page === next);
      btn.setAttribute('aria-current',btn.dataset.page === next ? 'page' : 'false');
    });
    render();
    window.scrollTo({top:0,behavior:'instant'});
  }
  function render() {
    switch(page) {
      case 'home': renderHome(); break;
      case 'editor': renderEditor(); break;
      case 'player': renderPlayer(); break;
      case 'history': renderHistory(); break;
      case 'settings': renderSettings(); break;
    }
  }
  function renderHome() {
    const totalMinutes = history.reduce((sum,h)=>sum+h.seconds,0) / 60;
    const badge = (icon,label,value,color='') => `<div class="stat-card"><div class="stat-icon ${color}">${ico(icon)}</div><div><strong class="stat-number">${value}</strong><div class="stat-label">${label}</div></div></div>`;
    byId('view').innerHTML = `
      <section class="hero"><div><div class="eyebrow">YOUR TRAINING SPACE / 01</div><h1>האימון שלך. הקצב שלך.</h1><p class="subtitle">תוכניות מדויקות, קצב נכון, ואתה בשליטה.</p></div><button class="btn primary hero-new" data-action="new">${ico('plus')} תוכנית חדשה</button></section>
      <div class="stats-row">${badge('dumbbell','תוכניות אימון',plans.length)}${badge('check','אימונים שהושלמו',history.length,'blue')}${badge('time','דקות אימון',Math.round(totalMinutes),'orange')}</div>
      <section><div class="section-title"><div><h2>תוכניות האימון שלי</h2><small>בחר תוכנית או צור אימון שמתאים בדיוק לך</small></div><span class="tag">${plans.length} תוכניות</span></div>
      ${plans.length ? `<div class="plan-list">${plans.map((p,i)=>renderPlanCard(p,i)).join('')}</div>` : `<div class="empty">${ico('activity')}<strong>עדיין אין תוכניות</strong><p>מומלץ להתחיל מתבנית קיימת או לבנות תוכנית אישית.</p><button class="btn primary" data-action="new">${ico('plus')} תוכנית ראשונה</button></div>`}</section>
      <section class="presets"><div class="section-title"><div><h2>להתחלה מהירה</h2><small>תבניות מוכנות לעריכה ולהתאמה אישית</small></div></div><div class="preset-grid">
      ${[['tabata','טאבטה קלאסית','20/10 · 8 סטים','activity'],['hiit','HIIT אנרגטי','אינטרוולים ועבודה','sparkle'],['strength','אימון כוח','מנוחות ארוכות יותר','dumbbell'],['stretch','מתיחות ושחרור','קצב רגוע','time']].map(([id,title,desc,icon])=>`<button class="preset-tile" data-action="preset" data-id="${id}">${ico(icon)}<div><b>${title}</b><br><small>${desc}</small></div></button>`).join('')}
      </div></section>`;
  }
  function renderPlanCard(p,i) {
    return `<article class="plan-card"><div class="plan-head"><div class="plan-emblem variation${i%4}">${ico(i%3===2?'dumbbell':'activity')}</div><span class="tag">READY TO GO</span></div><h3>${esc(p.name)}</h3><div class="plan-summary"><span>${ico('time')} <b dir="ltr">${durationLabel(planMs(p))}</b></span><span>${ico('activity')} ${p.exercises.length} תרגילים</span><span>${ico('refresh')} ${p.rounds} סבבים</span></div><div class="plan-card-actions"><button class="btn primary start-btn" data-action="start" data-id="${esc(p.id)}">${ico('play')} הפעל אימון</button><button class="btn secondary" data-action="edit" data-id="${esc(p.id)}">${ico('edit')} ערוך</button><button class="btn ghost icon-only" data-action="duplicate" data-id="${esc(p.id)}" aria-label="שכפל תוכנית" title="שכפל">${ico('copy')}</button><button class="btn ghost icon-only" data-action="delete" data-id="${esc(p.id)}" aria-label="מחק תוכנית" title="מחק">${ico('trash')}</button></div></article>`;
  }
  function openNew(preset = null) {
    if (preset) { editor = makePreset(preset); if (!editor) return; }
    else editor = {id:uid(),name:'',warmup:5,rounds:1,roundRest:30,exercises:[newExercise('תרגיל 1')]};
    editor.isExisting = false;
    navigate('editor');
  }
  function openEdit(id) {
    const p = plans.find(x=>x.id===id);
    if (!p) return;
    editor=clone(p);
    editor.isExisting=true;
    navigate('editor');
  }
  function renderEditor() {
    if (!editor) return navigate('home');
    const isEdit = editor.isExisting;
    byId('view').innerHTML = `
      <section class="page-heading"><div class="topline"><div><div class="eyebrow">WORKOUT BUILDER</div><h1>${isEdit?'עריכת תוכנית אימון':'בניית תוכנית חדשה'}</h1><p class="subtitle">קבע את הקצב והזמנים של כל תרגיל בנפרד.</p></div><button class="btn ghost" data-action="cancel">${ico('close')} סגור</button></div></section>
      <section class="form-card"><h2>פרטי התוכנית</h2><p class="card-intro">שם, זמן הכנה ומספר הסבבים של האימון.</p><div class="form-grid"><div class="field full"><label for="plan-name">שם התוכנית</label><input id="plan-name" maxlength="80" placeholder="לדוגמה: אימון בוקר" data-editor="name" value="${esc(editor.name)}"></div><div class="field"><label for="plan-warmup">הכנה (שניות)</label><input id="plan-warmup" inputmode="numeric" type="number" min="0" max="3600" data-editor="warmup" value="${esc(editor.warmup)}"></div><div class="field"><label for="plan-rounds">מספר סבבים</label><input id="plan-rounds" inputmode="numeric" type="number" min="1" max="100" data-editor="rounds" value="${esc(editor.rounds)}"></div><div class="field"><label for="plan-roundrest">מנוחה בין סבבים</label><input id="plan-roundrest" inputmode="numeric" type="number" min="0" max="3600" data-editor="roundRest" value="${esc(editor.roundRest)}"></div></div></section>
      <div class="section-title" style="margin-top:22px"><div><h2>רשימת התרגילים</h2><small>לכל תרגיל זמנים וסטים משלו</small></div><button class="btn ghost" data-action="add-exercise">${ico('plus')} הוסף תרגיל</button></div>
      <div id="exerciseList">${editor.exercises.map((e,i)=>exerciseHtml(e,i)).join('')}</div>
      <div class="info-note">${ico('info')}<span>זמן המנוחה של תרגיל מתבצע <b>לאחר כל סט, כולל הסט האחרון</b>. אם הוגדרה מנוחה בין סבבים, היא מתווספת בנפרד. כך משך התוכנית והטיימר נשארים זהים.</span></div>
      <div class="validation" id="editorError" aria-live="polite"></div>
      <div class="editor-footer"><div class="summary-box" id="editorSummary"></div><button class="btn primary" data-action="save">${ico('check')} שמור תוכנית</button></div>`;
    renderEditorSummary();
  }
  function exerciseHtml(e,i) {
    return `<section class="exercise-panel" data-exercise="${esc(e.id)}"><div class="exercise-title-row"><div class="exercise-heading"><span class="index-icon">${i+1}</span> תרגיל ${i+1}</div><div class="exercise-controls"><button class="btn ghost icon-only" data-action="move-up" data-id="${esc(e.id)}" ${i===0?'disabled':''} aria-label="העלה תרגיל">${ico('up')}</button><button class="btn ghost icon-only" data-action="move-down" data-id="${esc(e.id)}" ${i===editor.exercises.length-1?'disabled':''} aria-label="הורד תרגיל">${ico('down')}</button><button class="btn ghost icon-only" data-action="copy-exercise" data-id="${esc(e.id)}" aria-label="שכפל תרגיל">${ico('copy')}</button><button class="btn danger icon-only" data-action="remove-exercise" data-id="${esc(e.id)}" aria-label="מחק תרגיל">${ico('trash')}</button></div></div>
    <div class="form-grid"><div class="field full"><label for="ex-name-${esc(e.id)}">שם התרגיל</label><input id="ex-name-${esc(e.id)}" data-ex-id="${esc(e.id)}" data-ex-field="name" maxlength="80" value="${esc(e.name)}" placeholder="שם התרגיל"></div>
    <div class="field"><label for="ex-work-${esc(e.id)}">עבודה (שניות)</label><input id="ex-work-${esc(e.id)}" inputmode="numeric" type="number" min="1" max="3600" data-ex-id="${esc(e.id)}" data-ex-field="work" value="${esc(e.work)}"></div>
    <div class="field"><label for="ex-rest-${esc(e.id)}">מנוחה (שניות)</label><input id="ex-rest-${esc(e.id)}" inputmode="numeric" type="number" min="0" max="3600" data-ex-id="${esc(e.id)}" data-ex-field="rest" value="${esc(e.rest)}"></div>
    <div class="field"><label for="ex-sets-${esc(e.id)}">מספר סטים</label><input id="ex-sets-${esc(e.id)}" inputmode="numeric" type="number" min="1" max="100" data-ex-id="${esc(e.id)}" data-ex-field="sets" value="${esc(e.sets)}"></div></div></section>`;
  }
  function strictNum(raw) { return typeof raw === 'string' && raw.trim() !== '' && /^\d+$/.test(raw.trim()) ? Number(raw) : NaN; }
  function updateEditorField(input) {
    if (!editor) return;
    if (input.dataset.editor) editor[input.dataset.editor] = input.dataset.editor === 'name' ? input.value : strictNum(input.value);
    if (input.dataset.exId) {
      const e = editor.exercises.find(ex=>ex.id===input.dataset.exId);
      if (e) e[input.dataset.exField] = input.dataset.exField === 'name' ? input.value : strictNum(input.value);
    }
    renderEditorSummary();
  }
  function renderEditorSummary() {
    if (!editor || !byId('editorSummary')) return;
    const valid = validatePlan(editor);
    byId('editorSummary').innerHTML = valid
      ? `${ico('time')} <strong dir="ltr">${durationLabel(planMs(editor))}</strong><span> · ${editor.exercises.length} תרגילים</span>`
      : '<span>יש למלא את כל השדות במספרים תקינים</span>';
  }
  function updateExerciseList() { byId('exerciseList').innerHTML=editor.exercises.map((e,i)=>exerciseHtml(e,i)).join(''); renderEditorSummary(); }
  function editorAction(action,id) {
    if (!editor) return;
    const i = editor.exercises.findIndex(e=>e.id===id);
    if (action==='add-exercise') { if (editor.exercises.length>=100) return toast('ניתן להוסיף עד 100 תרגילים'); editor.exercises.push(newExercise(`תרגיל ${editor.exercises.length+1}`)); }
    if (action==='remove-exercise') { if (editor.exercises.length<=1) return toast('חייב להישאר לפחות תרגיל אחד'); if(i>=0) editor.exercises.splice(i,1); }
    if (action==='copy-exercise') { if (editor.exercises.length>=100) return toast('ניתן להוסיף עד 100 תרגילים'); if(i>=0) editor.exercises.splice(i+1,0,{...clone(editor.exercises[i]),id:uid()}); }
    if (action==='move-up' && i>0) [editor.exercises[i],editor.exercises[i-1]]=[editor.exercises[i-1],editor.exercises[i]];
    if (action==='move-down' && i>=0 && i<editor.exercises.length-1) [editor.exercises[i],editor.exercises[i+1]]=[editor.exercises[i+1],editor.exercises[i]];
    updateExerciseList();
  }
  function saveEditor() {
    if (!editor) return;
    editor.name=editor.name.trim();
    editor.exercises.forEach(e=>e.name=e.name.trim());
    if (!validatePlan(editor)) {
      const msg = 'ודא שכל השמות והמספרים תקינים. מגבלת אימון: 12 שעות או 2,500 שלבים.';
      byId('editorError').textContent=msg;
      toast('לא ניתן לשמור — בדוק את השדות');
      return;
    }
    const {isExisting, ...raw} = editor;
    const p = normalizePlan(raw);
    if (!p) return toast('התוכנית אינה תקינה');
    if (isExisting) plans=plans.map(x=>x.id===p.id?p:x);
    else {if(plans.length>=MAX_PLANS) return toast('הגעת למגבלת התוכניות');plans.unshift(p);}
    persistPlans();editor=null;navigate('home');toast('התוכנית נשמרה בהצלחה');
  }
  function duplicatePlan(id) {
    const p=plans.find(x=>x.id===id);if(!p)return;
    if(plans.length>=MAX_PLANS) return toast('הגעת למגבלת התוכניות');
    plans.unshift({...clone(p),id:uid(),name:(p.name.slice(0,72)+' (עותק)')});persistPlans();renderHome();toast('התוכנית שוכפלה');
  }
  function removePlan(id) {
    const p=plans.find(x=>x.id===id);if(!p)return;
    if (!confirm(`למחוק את התוכנית "${p.name}"?`))return;
    plans=plans.filter(x=>x.id!==id);persistPlans();renderHome();toast('התוכנית נמחקה');
  }

  // TIMER ENGINE — wall-clock based, with elapsed time carried across stages.
  function startPlan(id) {
    const p=plans.find(x=>x.id===id);
    if(!p)return;
    if(!validatePlan(p))return toast('לא ניתן להפעיל תוכנית עם פרטים לא תקינים');
    destroySession();
    const stages=makeSteps(p);
    session={planId:p.id,planName:p.name,steps:stages,totalMs:planMs(p),index:0,remainingMs:stages[0].duration,endAt:0,status:'ready',saved:false,lastCueSec:null};
    navigate('player');
  }
  function clearTimer() { if (intervalId!==null) {clearInterval(intervalId);intervalId=null;} }
  function destroySession() { clearTimer();releaseWake();session=null; }
  function stopPlayer() { if (session?.status==='running' && !confirm('לסיים את האימון לפני שהושלם?')) return; destroySession();navigate('home'); }
  function unlockAudio() {
    if(!settings.sound) return;
    try { const Cls=window.AudioContext||window.webkitAudioContext; if (!Cls) return; audioContext ??= new Cls(); if(audioContext.state==='suspended') audioContext.resume().catch(()=>{}); } catch {}
  }
  function beep(freq=880, length=.11) {
    if(!settings.sound||!audioContext||audioContext.state!=='running') return;
    try { const oscillator=audioContext.createOscillator();const gain=audioContext.createGain();oscillator.type='sine';oscillator.frequency.value=freq;gain.gain.setValueAtTime(.001,audioContext.currentTime);gain.gain.exponentialRampToValueAtTime(.11,audioContext.currentTime+.012);gain.gain.exponentialRampToValueAtTime(.001,audioContext.currentTime+length);oscillator.connect(gain);gain.connect(audioContext.destination);oscillator.start();oscillator.stop(audioContext.currentTime+length+.015); }catch{}
  }
  async function acquireWake() {
    if(!settings.wakeLock||!navigator.wakeLock||document.visibilityState!=='visible'||wakeLock) return;
    try {wakeLock=await navigator.wakeLock.request('screen');wakeLock.addEventListener('release',()=>wakeLock=null);}catch{}
  }
  function releaseWake() {if(wakeLock){const lock=wakeLock;wakeLock=null;lock.release().catch(()=>{});}}
  function runTimer() {
    if(!session)return;
    if(session.status==='finished'){session.index=0;session.remainingMs=session.steps[0].duration;session.saved=false;session.status='ready';}
    if(session.status==='running')return;
    unlockAudio();
    session.status='running';
    session.endAt=Date.now()+session.remainingMs;
    session.lastCueSec=null;
    clearTimer();
    intervalId=setInterval(pump,100);
    acquireWake();
    updatePlayer(true);
  }
  function pump() {
    const s=session;
    if(!s||s.status!=='running')return;
    const now=Date.now();
    let transitions=0;
    // The endAt deadline is advanced by the *duration of each new stage*.
    // It is never left pointing at an expired stage or reset per callback.
    while(s.status==='running' && now>=s.endAt && s.index<s.steps.length){
      s.index++;
      transitions++;
      if(s.index>=s.steps.length){finishWorkout();return;}
      s.endAt+=s.steps[s.index].duration;
      s.lastCueSec=null;
    }
    s.remainingMs=Math.max(0,s.endAt-now);
    if(transitions) {beep(s.steps[s.index].type==='work'?1000:620,.18);if(navigator.vibrate && document.visibilityState==='visible')navigator.vibrate(60);}
    const whole=Math.ceil(s.remainingMs/1000);
    if(whole<=3 && whole>0 && whole!==s.lastCueSec && s.steps[s.index].type!=='prepare') {
      s.lastCueSec=whole;
      beep(740,.06);
    }
    updatePlayer(transitions>0);
  }
  function pauseTimer() {
    if(!session||session.status!=='running')return;
    pump();
    if(session?.status!=='running')return;
    session.remainingMs=Math.max(0,session.endAt-Date.now());
    session.status='paused';clearTimer();releaseWake();updatePlayer(true);
  }
  function nextOrPrevStage(direction) {
    if(!session || session.status==='finished')return;
    const s=session;
    const target=s.index+direction;
    if(target<0)return;
    if(target>=s.steps.length){finishWorkout();return;}
    s.index=target;
    s.remainingMs=s.steps[target].duration;
    s.lastCueSec=null;
    if(s.status==='running')s.endAt=Date.now()+s.remainingMs;
    updatePlayer(true);
  }
  function finishWorkout() {
    if(!session||session.status==='finished')return;
    clearTimer();releaseWake();
    session.status='finished';session.remainingMs=0;session.index=session.steps.length;
    beep(1040,.24);
    if(!session.saved) {
      session.saved=true;
      history.unshift({id:uid(),planId:session.planId,name:session.planName,seconds:Math.round(session.totalMs/1000),date:new Date().toISOString()});
      history=history.slice(0,500);persistHistory();
    }
    renderPlayer();
  }
  function renderPlayer() {
    if(!session)return navigate('home');
    const s=session;
    if(s.status==='finished') {
      byId('view').innerHTML=`<div class="player-main"><div class="player-card"><div class="complete-box"><div class="complete-icon">${ico('check')}</div><div class="eyebrow" style="text-align:center">SESSION COMPLETE</div><h2>אימון הושלם!</h2><p>סיימת את <strong>${esc(s.planName)}</strong> — עוד אימון בדרך ליעד שלך.</p><div class="stats-row" style="max-width:420px;margin:0 auto 30px;grid-template-columns:repeat(2,1fr)"><div class="stat-card"><div><strong class="stat-number">${durationLabel(s.totalMs)}</strong><div class="stat-label">משך האימון</div></div></div><div class="stat-card"><div><strong class="stat-number">${s.steps.filter(x=>x.type==='work').length}</strong><div class="stat-label">סטים שבוצעו</div></div></div></div><div class="complete-actions"><button class="btn primary" data-action="restart">${ico('refresh')} הפעל שוב</button><button class="btn secondary" data-action="end">${ico('check')} לתוכניות שלי</button></div></div></div></div>`;
      return;
    }
    byId('view').innerHTML=`<div class="player-main"><div class="player-top"><div><h1>${esc(s.planName)}</h1><div class="subplayer">אימון פעיל · טיימר מדויק</div></div><button class="btn ghost" data-action="end">${ico('close')} סיום</button></div><section class="player-card" id="playerCard" data-phase="work"><div class="player-status"><span class="dot"></span><span id="playerPhase">WORK</span></div><div class="player-stage" id="playerStage"></div><div class="player-detail" id="playerDetail"></div><div class="dial"><svg class="dial-svg" viewBox="0 0 300 300" aria-hidden="true"><circle class="dial-track" cx="150" cy="150" r="132"/><circle class="dial-progress" id="dialRing" cx="150" cy="150" r="132" stroke-dasharray="829.38" stroke-dashoffset="0"/></svg><div class="dial-inner"><div class="dial-timer" id="dialClock" role="timer" aria-label="הזמן שנותר"></div><div class="dial-caption" id="dialCaption"></div></div></div><div class="player-foot"><div class="metric"><small>השלב הבא</small><b id="nextStage"></b></div><div class="metric"><small>התקדמות באימון</small><b id="sessionProgress"></b></div></div><div class="player-progress"><div id="sessionBar"></div></div></section><div class="player-buttons"><button class="btn secondary" data-action="prev" aria-label="לשלב הקודם">${ico('previous')}</button><button class="btn primary big-play" data-action="toggle" id="playPause"></button><button class="btn secondary" data-action="next" aria-label="לשלב הבא">${ico('next')}</button></div><p class="session-help">הספירה נמדדת לפי שעון אמיתי, גם אם המסך מתעדכן באיחור. להשמעת צלילים רציפה באייפון, מומלץ להשאיר את האפליקציה פתוחה ואת המסך פעיל.</p></div>`;
    updatePlayer(true);
  }
  function updatePlayer(stageChanged=false) {
    if(!session||session.status==='finished'||page!=='player'||!byId('dialClock'))return;
    const s=session, stage=s.steps[s.index];
    if(stageChanged){
      byId('playerCard').dataset.phase=stage.type;
      byId('playerPhase').textContent=stage.type==='work'?'WORK':stage.type==='rest'?'REST':'GET READY';
      byId('playerStage').textContent=stage.name;
      byId('playerDetail').textContent=stage.detail;
      byId('nextStage').textContent=s.steps[s.index+1]?.name || 'סיום האימון';
    }
    const seconds=Math.ceil(s.remainingMs/1000);
    const label=formatTime(seconds);
    if(byId('dialClock').textContent!==label)byId('dialClock').textContent=label;
    byId('dialCaption').textContent=`שלב ${s.index+1} מתוך ${s.steps.length}`;
    const fraction=Math.min(1,Math.max(0, s.remainingMs/stage.duration));
    byId('dialRing').style.strokeDashoffset=String((829.38*(1-fraction)).toFixed(2));
    const before=s.steps.slice(0,s.index).reduce((acc,st)=>acc+st.duration,0);
    const elapsed=Math.max(0,before+(stage.duration-s.remainingMs));
    const totalProgress=Math.min(100,100*elapsed/s.totalMs);
    byId('sessionProgress').textContent=`${Math.floor(totalProgress)}% הושלמו`;
    byId('sessionBar').style.width=totalProgress+'%';
    const btn=byId('playPause');
    btn.innerHTML=s.status==='running'?`${ico('pause')} השהה`:`${ico('play')} ${s.status==='ready'?'התחל אימון':'המשך אימון'}`;
  }

  function renderHistory() {
    byId('view').innerHTML=`<section class="page-heading"><div class="eyebrow">YOUR PROGRESS</div><h1>היסטוריית אימונים</h1><p class="subtitle">האימונים שהשלמת נשמרים מקומית במכשיר.</p></section>
    ${history.length?`<div class="panel"><h2>אימונים אחרונים</h2><p class="card-intro">${history.length} אימונים הושלמו · ${durationLabel(history.reduce((sum,h)=>sum+h.seconds*1000,0))} זמן מצטבר</p>${history.map(h=>`<div class="history-card"><div><h3>${esc(h.name)}</h3><p>${esc(hDate(h.date))}</p></div><div class="history-duration">${formatTime(h.seconds)}</div></div>`).join('')}</div><button class="btn ghost" data-action="clear-history">${ico('trash')} נקה היסטוריה</button>`:`<div class="empty">${ico('calendar')}<strong>עדיין אין אימונים שהושלמו</strong><p>לאחר שתשלים אימון, הוא יופיע כאן.</p><button class="btn primary" data-action="home">${ico('activity')} לתוכניות שלי</button></div>`}`;
  }
  function renderSettings() {
    byId('view').innerHTML=`<section class="page-heading"><div class="eyebrow">CUSTOMIZE & BACKUP</div><h1>הגדרות</h1><p class="subtitle">התאם את חוויית האימון ושמור את התוכניות שלך.</p></section>
    <div class="panel"><h2>חוויית האימון</h2><div class="setting-row"><div><strong>התראות קוליות</strong><p>צלילים בתחילת שלב ובשניות האחרונות שלו.</p></div><button type="button" role="switch" aria-label="התראות קוליות" aria-checked="${settings.sound}" data-action="sound" class="switch"></button></div><div class="setting-row"><div><strong>השאר מסך פעיל</strong><p>כאשר הדפדפן והמכשיר מאפשרים זאת.</p></div><button type="button" role="switch" aria-label="השאר מסך פעיל" aria-checked="${settings.wakeLock}" data-action="wake" class="switch"></button></div></div>
    <div class="panel"><h2>נתונים וגיבוי</h2><p class="card-intro">התוכניות וההיסטוריה נשמרות במכשיר בלבד. מחיקת נתוני האתר או שינוי כתובת האתר עלולים להסיר אותן.</p><div class="setting-actions"><button class="btn primary" data-action="export">${ico('download')} ייצוא גיבוי</button><button class="btn secondary" data-action="import">${ico('upload')} ייבוא גיבוי</button></div></div>
    <div class="info-note">${ico('info')}<span>להתקנה באייפון: פתח את האתר ב־Safari ← שיתוף ← ״הוסף למסך הבית״. לאחר טעינה ראשונה האפליקציה זמינה גם ללא אינטרנט. מערכת iOS עלולה להגביל צלילים ורענון כאשר המסך נעול.</span></div>
    <div class="panel" style="margin-top:17px"><h2>על האפליקציה</h2><p class="card-intro">Pulse Interval · גרסה 3.0 · אפליקציה חינמית ללא הרשמה</p><div style="font-size:11px;color:#90a2b6;letter-spacing:1.1px;direction:ltr;text-align:right">DESIGNED & DEVELOPED BY</div><div class="credit-large">Mordi Ben Aderet</div></div>`;
  }

  function exportBackup() {
    const backup={app:'Pulse Interval',version:3,exportedAt:new Date().toISOString(),plans,history};
    const blob=new Blob([JSON.stringify(backup,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;a.download=`pulse-interval-backup-${new Date().toISOString().slice(0,10)}.json`;document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),10000);
    toast('קובץ הגיבוי מוכן');
  }
  async function importBackup(file) {
    if(!file)return;
    try {
      if(file.size > 3*1024*1024) throw Error('קובץ גדול מדי');
      const data=JSON.parse(await file.text());
      if(!data || !Array.isArray(data.plans) || data.plans.length>MAX_PLANS)throw Error('קובץ לא תקין');
      const incoming=data.plans.map(normalizePlan);
      if(incoming.some(p=>!p))throw Error('נמצאו תוכניות לא תקינות בקובץ');
      if(plans.length+incoming.length>MAX_PLANS)throw Error('חריגה ממספר התוכניות המותר');
      if(!confirm(`לייבא ${incoming.length} תוכניות? התוכניות הקיימות יישארו.`))return;
      plans=[...plans,...incoming.map(p=>({...p,id:uid(),exercises:p.exercises.map(e=>({...e,id:uid()}))}))];
      if(Array.isArray(data.history)) {
        const imported=data.history.filter(h=>h && typeof h.name==='string' && Number.isFinite(h.seconds) && h.seconds>=0 && !Number.isNaN(Date.parse(h.date))).slice(0,500).map(h=>({...h,id:uid(),name:h.name.slice(0,80)}));
        history=[...history,...imported].sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,500);persistHistory();
      }
      persistPlans();render();toast('הגיבוי יובא בהצלחה');
    } catch(e) {toast(e.message||'קובץ הגיבוי אינו תקין');}
  }
  function onAction(action,id) {
    switch(action){
      case 'home':navigate('home');break;
      case 'new':openNew();break;
      case 'preset':openNew(id);break;
      case 'start':startPlan(id);break;
      case 'edit':openEdit(id);break;
      case 'duplicate':duplicatePlan(id);break;
      case 'delete':removePlan(id);break;
      case 'cancel':editor=null;navigate('home');break;
      case 'save':saveEditor();break;
      case 'add-exercise':case 'remove-exercise':case 'copy-exercise':case 'move-up':case 'move-down':editorAction(action,id);break;
      case 'toggle':if(session?.status==='running')pauseTimer();else runTimer();break;
      case 'next':nextOrPrevStage(1);break;
      case 'prev':nextOrPrevStage(-1);break;
      case 'end':stopPlayer();break;
      case 'restart':if(session){session.status='finished';runTimer();renderPlayer();}break;
      case 'clear-history':if(confirm('למחוק את כל היסטוריית האימונים?')){history=[];persistHistory();renderHistory();toast('ההיסטוריה נמחקה');}break;
      case 'sound':settings.sound=!settings.sound;writeJson(SETTINGS_KEY,settings);writeJson('pulseSound',settings.sound);renderSettings();break;
      case 'wake':settings.wakeLock=!settings.wakeLock;writeJson(SETTINGS_KEY,settings);if(!settings.wakeLock)releaseWake();renderSettings();break;
      case 'export':exportBackup();break;
      case 'import':byId('backupPicker').click();break;
    }
  }
  document.addEventListener('click',ev=>{
    const button=ev.target.closest('button');
    if(!button||button.disabled)return;
    if(button.dataset.page){navigate(button.dataset.page);return;}
    if(button.dataset.action)onAction(button.dataset.action,button.dataset.id);
  });
  document.addEventListener('input',ev=>{const input=ev.target;if(input.matches('[data-editor],[data-ex-id]'))updateEditorField(input);});
  byId('backupPicker').addEventListener('change',async ev=>{const f=ev.target.files?.[0];await importBackup(f);ev.target.value='';});
  document.addEventListener('visibilitychange',()=>{
    if(session?.status==='running') {
      pump();
      if(document.visibilityState==='visible')acquireWake();
    }
  });
  window.addEventListener('pageshow',()=>{if(session?.status==='running')pump();});
  window.addEventListener('beforeunload',()=>releaseWake());
  if('serviceWorker'in navigator) window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
  navigate('home');
  // Diagnostics are read-only; useful for validating the clock without modifying state.
  window.PulseIntervalDiagnostics = Object.freeze({
    getTimer:()=>session?{status:session.status,index:session.index,remainingMs:session.remainingMs,deadline:session.endAt,steps:session.steps.map(x=>({type:x.type,name:x.name,duration:x.duration}))}:null,
    getPlans:()=>clone(plans)
  });
})();
