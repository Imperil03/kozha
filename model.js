(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ReportModel = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const ENGINES = ['yandex', 'google'];
  const validMonth = v => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
  function monthLabel(month, year = true) {
    if (!validMonth(month)) return '';
    const s = new Intl.DateTimeFormat('ru-RU', {month:'long', ...(year ? {year:'numeric'} : {}), timeZone:'UTC'}).format(new Date(month+'-15T12:00:00Z')).replace(/ г\.$/, '');
    return s[0].toUpperCase()+s.slice(1);
  }
  function safeHref(value) {
    if (typeof value !== 'string' || /[\u0000-\u0020]/.test(value)) return null;
    if (/^evidence\/[a-zA-Z0-9][a-zA-Z0-9._-]*\.(png|jpe?g|webp|pdf|xlsx|csv|txt)$/i.test(value)) return value;
    try {const u=new URL(value); return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password ? u.href : null;} catch {return null;}
  }
  const getReport = (data, month) => data.reports.find(r=>r.month===month) || null;
  const defaultMonth = data => getReport(data,data.project.defaultMonth) ? data.project.defaultMonth : data.reports.at(-1)?.month;
  function readRoute(data, href) {
    const url = new URL(href);
    const month = getReport(data,url.searchParams.get('month')) ? url.searchParams.get('month') : defaultMonth(data);
    const tab = url.hash === '#works' ? 'works' : 'results';
    const detail = url.searchParams.get('task');
    return {month,tab,detail:tab==='works'&&getReport(data,month)?.works.some(w=>w.id===detail) ? detail : null};
  }
  function change(before, after, comparable = true) {
    if (!comparable || before === undefined || after === undefined) return {kind:'no_data'};
    if (before === after) return {kind:'same'};
    if (before === null) return {kind:'appeared'};
    if (after === null) return {kind:'lost'};
    return {kind: after < before ? 'up' : 'down', amount:Math.abs(before-after)};
  }
  const measured = v => v === null || (Number.isInteger(v) && v > 0);
  function comparableSnapshots(a,b) {
    return !!a && !!b && a.region===b.region && a.device===b.device && a.sourceLabel===b.sourceLabel &&
      ENGINES.every(e=>a.regionIndexes?.[e]===b.regionIndexes?.[e]) && a.date < b.date;
  }
  function rankingsView(rankings) {
    if (!rankings?.after) return null;
    const {before,after}=rankings;
    const comparable=comparableSnapshots(before,after);
    const previous=new Map((before?.rows||[]).map(r=>[r.id,r]));
    const current=new Map(after.rows.map(r=>[r.id,r]));
    const all=[...after.rows, ...(before?.rows||[]).filter(r=>!current.has(r.id))];
    const rows=all.map(row=>({id:row.id,query:row.query,direction:row.direction||'',...Object.fromEntries(ENGINES.map(e=>{
      const a=previous.get(row.id)?.[e], b=current.get(row.id)?.[e];
      return [e,{before:a,after:b,change:change(a,b,comparable)}];
    }))}));
    const stats=Object.fromEntries(ENGINES.map(e=>{
      const common=comparable ? rows.filter(r=>measured(r[e].before)&&measured(r[e].after)) : [];
      const present=after.rows.filter(r=>measured(r[e]));
      const cohort=common.length ? common : present.map(r=>({[e]:{after:r[e]}}));
      const metric=top=>({before:common.length?common.filter(r=>typeof r[e].before==='number'&&r[e].before<=top).length:null,
        after:cohort.filter(r=>typeof r[e].after==='number'&&r[e].after<=top).length});
      return [e,{total:cohort.length,measured:present.length,comparable:common.length>0,newCount:comparable?present.filter(r=>!measured(previous.get(r.id)?.[e])).length:0,top3:metric(3),top10:metric(10)}];
    }));
    return {before,after,rows,stats,comparable};
  }
  function archiveRows(report) {
    return report.positions.rows.map(r=>({...r,direction:'',archive:true}));
  }
  function filterRows(rows,{search='',direction='',trend='all'}={}) {
    const q=search.toLocaleLowerCase('ru-RU').trim();
    return rows.filter(r=> (!q || [r.query,r.googleQueryCell?.text].filter(Boolean).some(s=>s.toLocaleLowerCase('ru-RU').includes(q))) &&
      (!direction || r.direction===direction) && (trend==='all' || ENGINES.some(e=>{
        if(r.archive) return true;
        const c=r[e].change.kind;
        return trend==='up'?['up','appeared'].includes(c):trend==='down'?['down','lost'].includes(c):trend==='new'?r[e].before===undefined&&measured(r[e].after):c==='same';
      })));
  }
  function validateCell(c) {
    if(!c || typeof c.text!=='string') throw Error('Некорректный текст ячейки.');
    if(c.runs && (!Array.isArray(c.runs)||c.runs.some(r=>typeof r.text!=='string')||c.runs.map(r=>r.text).join('')!==c.text)) throw Error('Нарушена целостность форматированного текста.');
  }
  function validateImage(i){
    if(!i||typeof i.path!=='string'||!safeHref(i.path)||!Number.isFinite(i.width)||!Number.isFinite(i.height)||i.width<=0||i.height<=0)throw Error('Некорректное изображение.');
  }
  function validateData(data) {
    if(data?.project?.id!=='kozha'||data.project.website!=='https://kozhaclinic.ru/') throw Error('Чужой проект.');
    if(!Array.isArray(data.reports)||!data.reports.length) throw Error('Нет отчётов.');
    const months=new Set();
    for(const report of data.reports) {
      if(report.projectId!=='kozha'||!validMonth(report.month)||months.has(report.month)) throw Error('Некорректный или повторный месяц.');
      months.add(report.month);
      const ids=new Set();
      if(!Array.isArray(report.works)) throw Error('Нет списка работ.');
      for(const work of report.works) {
        if(typeof work.id!=='string'||ids.has(work.id)) throw Error('Повторная работа.');
        ids.add(work.id); ['title','why','description','attachment'].forEach(k=>validateCell(work[k]));
        (work.evidence||[]).forEach(validateImage);
      }
      if(report.kind==='archive') {
        if(report.source?.type!=='google-sheets'||!report.positions?.rows?.length) throw Error('Неполный архив.');
        for(const e of ENGINES) {
          if(!report.positions.headers[e]?.length) throw Error('Нет дат архива.');
          report.metrics[e].forEach(m=>{if(![3,10].includes(m.top))throw Error('Некорректный показатель.');['before','after','delta'].forEach(k=>validateCell(m[k]));});
          for(const r of report.positions.rows) {
            if(r[e].length!==report.positions.headers[e].length) throw Error('Потерян столбец позиций.');
            r[e].forEach(validateCell);
          }
        }
        report.images.forEach(validateImage);
      } else if(report.kind==='current') {
        if(report.rankings?.after) {
          if(!report.rankings.after.date.startsWith(report.month+'-')) throw Error('Замер относится к другому месяцу.');
          for(const snap of [report.rankings.before,report.rankings.after].filter(Boolean)) {
            if(!Array.isArray(snap.rows)||new Set(snap.rows.map(r=>r.id)).size!==snap.rows.length) throw Error('Повторные запросы API.');
            for(const row of snap.rows) for(const e of ENGINES) if(row[e]!==undefined&&!measured(row[e])) throw Error('Некорректная позиция API.');
          }
        }
      } else throw Error('Неизвестный вид отчёта.');
    }
    if(!months.has(data.project.defaultMonth)) throw Error('Нет текущего месяца.');
    return true;
  }
  return {ENGINES,validMonth,monthLabel,safeHref,getReport,defaultMonth,readRoute,change,rankingsView,archiveRows,filterRows,validateData,comparableSnapshots};
});
