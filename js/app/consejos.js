/* =========================================================================
 * app/consejos.js — Recomendaciones y perfil de inversor.
 * La interfaz está repartida en js/app/*.js: todos comparten el ámbito global
 * (funciones y variables de nivel superior) y se cargan en el orden de index.html.
 * ========================================================================= */
'use strict';

// ================================================================ recomendaciones
var SEV = { alta: ['!', 'Importante'], media: ['!', 'Atención'], baja: ['i', 'Sugerencia'], ok: ['✓', 'Bien'] };
var editingProfile = false;

function sevBadge(sev) { return '<span class="sev"><i aria-hidden="true">' + SEV[sev][0] + '</i>' + SEV[sev][1] + '</span>'; }

function currentRecs() {
  if (!state.profile) return null;
  return Advisor.recommend(state, state.profile, S.today(), function (v) { return fmtMoney(v, base()); }, LOCALE);
}

function renderAdvice() {
  var recs = currentRecs();
  var P = state.profile ? Advisor.PROFILES[state.profile.type] : null;

  // --- Tarjeta en Inicio ---
  var home = $('#home-recs-body');
  if (!recs) {
    home.innerHTML = '<p class="muted small" style="margin:0 0 10px">Responde 5 preguntas y recibe recomendaciones según tu perfil, tus gastos y tu portafolio.</p>' +
      '<button type="button" class="primary" data-action="start-profile">Hacer el test (1 min)</button>';
  } else {
    var top = recs.filter(function (r) { return r.severity !== 'ok'; }).slice(0, 3);
    var rev = Insights.profileReview(state, state.profile, S.today());
    if (rev.length) top = [{ severity: 'media', title: 'Revisa tu perfil de inversor', why: rev[0].text }].concat(top.slice(0, 2));
    home.innerHTML = top.length ? top.map(function (r) {
      return '<div class="home-rec" data-sev="' + r.severity + '">' + '<span class="sev"><i aria-hidden="true">' + SEV[r.severity][0] + '</i></span>' +
        '<div><div class="t">' + esc(r.title) + '</div><div class="w">' + esc(r.why) + '</div></div></div>';
    }).join('') : '<p class="muted small" style="margin:0">Todo en orden según tu perfil ' + esc(P.label.toLowerCase()) + ': no hay alertas.</p>';
  }

  // --- Vista de consejos ---
  var form = $('#profile-form');
  var showForm = !state.profile || editingProfile;
  form.classList.toggle('hidden', !showForm);
  $('#profile-card').classList.toggle('hidden', !state.profile || editingProfile);
  // Se rellena solo al abrirse: un redibujado (p. ej. precios cada 2 min) no borra respuestas a medias
  if (showForm && !form.dataset.filled) { fillProfileForm(); form.dataset.filled = '1'; }
  if (!showForm) delete form.dataset.filled;

  var cur = S.today().slice(0, 7);
  $('#advice-summary').innerHTML = '';
  var sumPrev = summaryHtml(Insights.prevMonth(cur)), sumCur = summaryHtml(cur, { title: monthNameOf(cur).replace(/^./, function (c) { return c.toUpperCase(); }) + ' hasta hoy' });
  $('#advice-summary').classList.toggle('hidden', !sumPrev && !sumCur);
  $('#advice-summary').innerHTML = (sumCur ? sumCur.replace('<div class="card summary-card">', '<div class="summary-card">') : '') +
    (sumPrev ? sumPrev.replace('<div class="card summary-card">', '<div class="summary-card" style="margin-top:14px">') : '');
  if (!recs) {
    $('#recs-headline').textContent = 'Empieza por tu perfil';
    $('#recs-summary').textContent = 'Con tus respuestas ajusto los límites de riesgo, el fondo de emergencia y la meta de ahorro.';
    $('#recs-list').innerHTML = '';
    return;
  }
  var counts = { alta: 0, media: 0, baja: 0, ok: 0 };
  recs.forEach(function (r) { counts[r.severity]++; });
  var pending = counts.alta + counts.media + counts.baja;
  $('#recs-headline').textContent = pending ? pending + (pending === 1 ? ' recomendación para ti' : ' recomendaciones para ti') : 'Todo en orden';
  $('#recs-summary').textContent = [
    counts.alta && counts.alta + (counts.alta === 1 ? ' importante' : ' importantes'),
    counts.media && counts.media + ' de atención',
    counts.baja && counts.baja + (counts.baja === 1 ? ' sugerencia' : ' sugerencias'),
    counts.ok && counts.ok + (counts.ok === 1 ? ' punto bien' : ' puntos bien')
  ].filter(Boolean).join(' · ');

  var pr = state.profile;
  $('#profile-card').innerHTML =
    '<div class="profile-head"><div><div class="eyebrow">Tu perfil de inversor</div><div class="profile-type">' + esc(P.label) + '</div></div>' +
    '<button type="button" data-action="edit-profile">Editar perfil</button></div>' +
    '<p class="rec-why" style="margin-top:6px">' + esc(P.desc) + ' Puntaje ' + pr.score + ' de 20' +
    (pr.cappedFrom ? ' (te correspondía ' + esc(Advisor.PROFILES[pr.cappedFrom].label.toLowerCase()) + ', pero tu horizonte es corto y conviene menos riesgo)' : '') + '.</p>' +
    (pr.goals && pr.goals.length ? '<p class="small muted" style="margin:6px 0 0">Objetivos: ' + pr.goals.map(function (g) { return esc(Advisor.GOALS[g]); }).join(', ') + '</p>' : '') +
    '<div class="profile-params">' +
    '<div><span>Inversiones de riesgo</span><b>' + P.risk[0] + '–' + P.risk[1] + ' % del patrimonio</b></div>' +
    '<div><span>Cripto como máximo</span><b>' + P.cryptoMax + ' %</b></div>' +
    '<div><span>Fondo de emergencia</span><b>' + (Number(pr.emergencyMonths) || P.emergency) + ' meses</b></div>' +
    '<div><span>Meta de ahorro</span><b>' + (Number(pr.savingsGoal) || 20) + ' %</b></div></div>';

  var review = Insights.profileReview(state, state.profile, S.today());
  if (review.length) {
    $('#profile-card').insertAdjacentHTML('beforeend', '<div class="review-box"><b>Conviene repetir el test</b><ul>' +
      review.map(function (x) { return '<li>' + esc(x.text) + '</li>'; }).join('') + '</ul>' +
      '<button type="button" class="primary" data-action="review-profile">Repetir el test (1 min)</button></div>');
  }
  $('#recs-list').innerHTML = recs.map(function (r) {
    return '<article class="rec" data-sev="' + r.severity + '">' +
      '<div class="rec-top">' + sevBadge(r.severity) + '<span class="tag">' + esc(r.area) + '</span></div>' +
      '<div class="rec-title">' + esc(r.title) + '</div>' +
      '<p class="rec-why"><b>Por qué:</b> ' + esc(r.why) + '</p>' +
      '<details><summary>Cómo se calculó</summary><div class="rec-data">' + esc(r.data) + '</div></details></article>';
  }).join('');
}

function fillProfileForm() {
  var pr = state.profile || {};
  var ans = pr.answers || {};
  $('#quiz').innerHTML = Advisor.QUESTIONS.map(function (q, qi) {
    return '<fieldset class="quiz-q"><legend>' + (qi + 1) + '. ' + esc(q.text) + '</legend><div class="quiz-opts">' +
      q.options.map(function (o, oi) {
        return '<label><input type="radio" name="q_' + q.id + '" value="' + (oi + 1) + '"' + (Number(ans[q.id]) === oi + 1 ? ' checked' : '') + ' required>' + esc(o) + '</label>';
      }).join('') + '</div></fieldset>';
  }).join('');
  $('#goals').innerHTML = Object.keys(Advisor.GOALS).map(function (g) {
    return '<label><input type="checkbox" name="goal" value="' + g + '"' + ((pr.goals || []).indexOf(g) !== -1 ? ' checked' : '') + '>' + esc(Advisor.GOALS[g]) + '</label>';
  }).join('');
  var f = $('#profile-form');
  f.emergencyMonths.value = pr.emergencyMonths || '';
  f.savingsGoal.value = pr.savingsGoal || 20;
}

function onProfileSubmit(e) {
  e.preventDefault();
  var f = e.target, answers = {}, missing = 0;
  Advisor.QUESTIONS.forEach(function (q) {
    var c = f.querySelector('input[name="q_' + q.id + '"]:checked');
    if (c) answers[q.id] = Number(c.value); else missing++;
  });
  if (missing) { toast('Responde las 5 preguntas (faltan ' + missing + ')'); return; }
  var goal = num(f.savingsGoal.value);
  if (!(goal > 0 && goal < 100)) { toast('La meta de ahorro debe estar entre 1 y 99 %'); return; }
  var res = Advisor.scoreProfile(answers);
  state.profile = {
    answers: answers, score: res.score, type: res.type, cappedFrom: res.cappedFrom,
    goals: $$('input[name="goal"]:checked', f).map(function (x) { return x.value; }),
    emergencyMonths: f.emergencyMonths.value ? Number(f.emergencyMonths.value) : null,
    savingsGoal: goal, updatedAt: Date.now(),
    context: Insights.profileContext(state, S.today())   // para proponer repetir el test si tu situación cambia
  };
  editingProfile = false;
  persist();
  window.scrollTo(0, 0);
  toast('Tu perfil: ' + Advisor.PROFILES[res.type].label);
}

/** Aviso de copia de seguridad: con datos y sin copia en los últimos 30 días. */
function renderBackupReminder() {
  var count = state.transactions.length + state.investments.length;
  var last = state.settings.lastBackupAt;
  var days = last ? Math.floor((Date.now() - last) / 86400000) : null;
  var show = count >= 5 && (days === null || days >= 30);
  $('#backup-reminder').innerHTML = show
    ? '<div class="warning reminder"><span>' + (days === null ? 'Aún no has descargado una copia de seguridad (archivo fuera del dispositivo).' : 'Hace ' + days + ' días que no descargas una copia de seguridad (archivo fuera del dispositivo).') +
      '</span><button type="button" data-action="backup">Hacer copia ahora</button></div>' : '';
}
