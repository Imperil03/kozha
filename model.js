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
  const workDetailsEnabled = report => !!report && report.month >= '2026-10';
  function readRoute(data, href) {
    const url = new URL(href);
    const month = getReport(data,url.searchParams.get('month')) ? url.searchParams.get('month') : defaultMonth(data);
    const tab = url.hash === '#works' ? 'works' : 'results';
    const detail = url.searchParams.get('task');
    return {month,tab,detail:tab==='works'&&workDetailsEnabled(getReport(data,month))&&getReport(data,month)?.works.some(w=>w.id===detail) ? detail : null};
  }
  function sliceCell(cell,start,end=cell.text.length){
    const result={...cell,text:cell.text.slice(start,end)};
    if(cell.runs){
      let offset=0;
      result.runs=cell.runs.flatMap(run=>{
        const from=Math.max(start-offset,0),to=Math.min(end-offset,run.text.length);
        offset+=run.text.length;
        return to>from?[{...run,text:run.text.slice(from,to)}]:[];
      });
    }
    return result;
  }
  function proseBlocks(cells){
    const result=[];
    let list=null;
    for(let cell of cells){
      if(typeof cell==='string')cell={text:cell};
      if(!cell?.text?.trim()){list=null;continue;}
      const lines=[...cell.text.matchAll(/[^\r\n]+|\r\n|\r|\n/g)];
      if(!/^[\t ]*(?:[-–—•*][\t ]+|\d+[.)][\t ]+)/m.test(cell.text)){
        result.push({type:'p',cell});list=null;continue;
      }
      let paragraphStart=null,paragraphEnd=null,newlines=0;
      const flush=()=>{if(paragraphStart!==null){result.push({type:'p',cell:sliceCell(cell,paragraphStart,paragraphEnd)});paragraphStart=null;list=null;}};
      for(const line of lines){
        if(/^[\r\n]+$/.test(line[0])){newlines++;if(newlines>1){flush();list=null;}continue;}
        const marker=line[0].match(/^[\t ]*(?:([-–—•*])[\t ]+|(\d+)[.)][\t ]+)/);
        if(marker){
          flush();
          const type=marker[1]?'ul':'ol',start=marker[2]?Number(marker[2]):null;
          if(!list||list.type!==type){list={type,items:[],...(type==='ol'?{start}:{})};result.push(list);}
          list.items.push({cell:sliceCell(cell,line.index+marker[0].length,line.index+line[0].length),...(type==='ol'?{value:start}:{})});
        }else{
          if(paragraphStart===null)paragraphStart=line.index;
          paragraphEnd=line.index+line[0].length;
        }
        newlines=0;
      }
      flush();
    }
    return result;
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
      return [e,{before:a,after:b,comparable,change:change(a,b,comparable)}];
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
  const normalizeQuery=query=>query.normalize('NFKC').toLocaleLowerCase('ru-RU').trim().replace(/\s+/g,' ');
  function groupIndex(groups=[]){
    const index=new Map();
    for(const row of groups){
      const key=normalizeQuery(row.query);
      if(index.has(key)&&index.get(key)!==row.direction)index.set(key,'');
      else if(!index.has(key))index.set(key,row.direction);
    }
    return index;
  }
  function archiveValue(cell){
    const text=cell?.text?.trim();
    if(text==='101')return null;
    return /^[1-9]\d*$/.test(text||'')?Number(text):undefined;
  }
  function archiveDate(label){
    const m=typeof label==='string'&&label.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if(!m)return null;
    const date=new Date(Date.UTC(Number(m[3]),Number(m[2])-1,Number(m[1])));
    return date.getUTCFullYear()===Number(m[3])&&date.getUTCMonth()===Number(m[2])-1&&date.getUTCDate()===Number(m[1])?date.valueOf():null;
  }
  function rankBand(value){
    if(typeof value==='string')value=/^[1-9]\d*$/.test(value.trim())?Number(value.trim()):undefined;
    if(!Number.isInteger(value)||value<1)return 'missing';
    return value<=3?'top3':value<=10?'top10':'other';
  }
  function archiveRows(report,groups=[]) {
    const index=groupIndex(groups);
    return report.positions.rows.map(r=>{
      const direction=index.get(normalizeQuery(r.query))||index.get(normalizeQuery(r.googleQueryCell?.text||r.query))||'';
      const changes=Object.fromEntries(ENGINES.map(e=>{
        const before=archiveValue(r[e].at(-2)),after=archiveValue(r[e].at(-1));
        const first=archiveDate(report.positions.headers?.[e]?.at(-2)),last=archiveDate(report.positions.headers?.[e]?.at(-1));
        const comparable=first!==null&&last!==null&&first<last;
        return [e,{before,after,comparable,change:change(before,after,comparable)}];
      }));
      return {...r,direction,changes,archive:true};
    });
  }
  function filterRows(rows,{search='',direction='',trend='all'}={}) {
    const q=search.toLocaleLowerCase('ru-RU').trim();
    return rows.filter(r=> (!q || [r.query,r.googleQueryCell?.text].filter(Boolean).some(s=>s.toLocaleLowerCase('ru-RU').includes(q))) &&
      (!direction || (direction==='__unmapped'?!r.direction:r.direction===direction)) && (trend==='all' || ENGINES.some(e=>{
        const values=r.archive?r.changes[e]:r[e];
        const c=values.change.kind;
        return trend==='up'?['up','appeared'].includes(c):trend==='down'?['down','lost'].includes(c):trend==='new'?values.comparable!==false&&values.before===undefined&&measured(values.after):c==='same';
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
    if(data.keywordGroups){
      if(!Array.isArray(data.keywordGroups)&&data.keywordGroups.projectId!==25767208)throw Error('Группы относятся к другому проекту.');
      for(const group of (Array.isArray(data.keywordGroups)?data.keywordGroups:data.keywordGroups.rows||[])){if(typeof group.query!=='string'||typeof group.direction!=='string')throw Error('Некорректная группа запросов.');}
    }
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
  return {ENGINES,validMonth,monthLabel,safeHref,getReport,defaultMonth,readRoute,workDetailsEnabled,sliceCell,proseBlocks,change,rankingsView,archiveRows,filterRows,validateData,comparableSnapshots,rankBand,groupIndex};
});
