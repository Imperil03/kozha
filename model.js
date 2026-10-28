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
  function comparableEngine(a,b,engine) {
    if(!a||!b)return false;
    const left=a.engines?.[engine],right=b.engines?.[engine];
    if(left||right){
      if(!left||!right)return false;
      const keys=['sourceLabel','method','region','regionId','device','language','depth'];
      return keys.every(k=>left[k]!==undefined&&left[k]!==null&&left[k]!==''&&left[k]===right[k])&&
        Number.isFinite(Date.parse(left.observedTo))&&Number.isFinite(Date.parse(right.observedFrom))&&
        Date.parse(left.observedTo)<Date.parse(right.observedFrom);
    }
    const depth=s=>typeof s.depth==='object'?s.depth?.[engine]:s.depth;
    // Legacy snapshots keep their original unknown depth. A known/unknown or
    // changed depth is never silently treated as the same measurement method.
    return ['region','device','sourceLabel'].every(k=>typeof a[k]==='string'&&a[k].trim()&&a[k]===b[k])&&
      a.regionIndexes?.[engine]!==undefined&&a.regionIndexes?.[engine]!==null&&
      a.regionIndexes?.[engine]===b.regionIndexes?.[engine]&&depth(a)===depth(b)&&a.date<b.date;
  }
  function comparableSnapshots(a,b,engine) {
    return engine?comparableEngine(a,b,engine):ENGINES.every(e=>comparableEngine(a,b,e));
  }
  function rankingSeriesOptions(report) {
    return [...(report.rankingSeries||[]).map(s=>({id:s.id,label:s.label})),
      ...(report.rankings?.after?[{id:'topvisor',label:'Топвизор — сохранённая история'}]:[])];
  }
  function selectRankingSeries(report,seriesId) {
    const series=report.rankingSeries||[];
    if(seriesId==='topvisor'&&report.rankings?.after)return {id:'topvisor',label:'Топвизор — сохранённая история',...report.rankings};
    const selected=series.find(s=>s.id===seriesId)||series.at(-1);
    if(selected)return selected;
    if(report.rankings?.after)return {id:'topvisor',label:'Топвизор — сохранённая история',...report.rankings};
    return series.at(-1)||null;
  }
  const rowCohorts=row=>row.cohorts||['base',...(row.direction==='Сентябрь 2026'?['september']:[])];
  function filterRankingPopulation(rows,{cohort='all',direction='',search=''}={}) {
    const q=search.toLocaleLowerCase('ru-RU').trim();
    return rows.filter(r=>(cohort==='all'||rowCohorts(r).includes(cohort))&&
      (!direction||(direction==='__unmapped'?!r.direction:r.direction===direction))&&
      (!q||r.query.toLocaleLowerCase('ru-RU').includes(q)));
  }
  function rankingsView(rankings) {
    if (!rankings?.after) return null;
    const {before,after}=rankings;
    const compatibleEngines=Object.fromEntries(ENGINES.map(e=>[e,comparableEngine(before,after,e)]));
    const previous=new Map((before?.rows||[]).map(r=>[r.id,r]));
    const current=new Map(after.rows.map(r=>[r.id,r]));
    const previousFor=row=>{const old=previous.get(row.id);return old&&normalizeQuery(old.query)===normalizeQuery(row.query)?old:null;};
    const all=[...after.rows, ...(before?.rows||[]).filter(r=>!current.has(r.id))];
    const rows=all.map(row=>({id:row.id,query:row.query,direction:row.direction||'',cohorts:rowCohorts(row),urls:row.urls||{},...Object.fromEntries(ENGINES.map(e=>{
      const a=previousFor(row)?.[e], b=current.get(row.id)?.[e];
      const comparable=compatibleEngines[e];
      return [e,{before:a,after:b,comparable,change:change(a,b,comparable)}];
    }))}));
    const stats=Object.fromEntries(ENGINES.map(e=>{
      const common=compatibleEngines[e] ? rows.filter(r=>measured(r[e].before)&&measured(r[e].after)) : [];
      const present=after.rows.filter(r=>measured(r[e]));
      const cohort=common.length ? common : present.map(r=>({[e]:{after:r[e]}}));
      const metric=top=>({before:common.length?common.filter(r=>typeof r[e].before==='number'&&r[e].before<=top).length:null,
        after:cohort.filter(r=>typeof r[e].after==='number'&&r[e].after<=top).length});
      const countCurrent=top=>present.filter(r=>typeof r[e]==='number'&&r[e]<=top).length;
      const movements=common.length?{
        up:common.filter(r=>['up','appeared'].includes(r[e].change.kind)).length,
        down:common.filter(r=>['down','lost'].includes(r[e].change.kind)).length,
        same:common.filter(r=>r[e].change.kind==='same').length,
      }:null;
      return [e,{total:cohort.length,measured:present.length,hasCurrent:present.length>0,comparable:common.length>0,
        newCount:compatibleEngines[e]?present.filter(r=>!measured(previousFor(r)?.[e])).length:0,
        currentTotal:present.length,currentTop3:countCurrent(3),currentTop10:countCurrent(10),currentTop50:countCurrent(50),
        movements,top3:metric(3),top10:metric(10),top50:metric(50)}];
    }));
    return {before,after,rows,stats,compatibleEngines,comparable:ENGINES.some(e=>stats[e].comparable)};
  }
  function scopedRankingsView(rankings,filters={}) {
    if(!rankings?.after)return null;
    const scope=s=>s?{...s,rows:filterRankingPopulation(s.rows,filters)}:null;
    return rankingsView({...rankings,before:scope(rankings.before),after:scope(rankings.after)});
  }
  function clientTimelineView(report,rankings,filters={}) {
    const view=scopedRankingsView(rankings,filters);
    if(!view)return null;
    const snapshots=[report.rankingHistory?.initial,report.rankingHistory?.previous||report.rankings?.before||rankings.before,rankings.after];
    const indexes=snapshots.map(s=>new Map((s?.rows||[]).map(r=>[r.id,r])));
    const rows=view.rows.map(row=>({...row,...Object.fromEntries(ENGINES.map(e=>[e,{...row[e],history:indexes.map(index=>{
      const historical=index.get(row.id);
      return historical&&normalizeQuery(historical.query)===normalizeQuery(row.query)?historical[e]:undefined;
    })}]))}));
    // Counts are observations on each date, not cross-provider movement. A
    // display fallback of 101 must never become a stored measurement or gain.
    const stats=Object.fromEntries(ENGINES.map(e=>[e,Object.fromEntries([3,10,50].map(top=>['top'+top,snapshots.map((_,i)=>rows.filter(row=>Number.isInteger(row[e].history[i])&&row[e].history[i]<=top).length)]))]));
    return {...view,rows,timeline:{dates:snapshots.map(s=>s?.date||null),total:rows.length,stats}};
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
  function validateDetailBlock(block){
    if(block?.table===undefined){validateCell(block);return;}
    const t=block.table;
    validateCell(t?.caption);
    if(!Array.isArray(t.headers)||t.headers.length<2||!Array.isArray(t.rows)||!t.rows.length)throw Error('Некорректная таблица работы.');
    t.headers.forEach(validateCell);
    for(const row of t.rows){
      if(!Array.isArray(row)||row.length!==t.headers.length)throw Error('Нарушено число столбцов таблицы работы.');
      row.forEach(validateCell);
    }
  }
  const DAY=86400000;
  function validDate(value){
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
    const time=Date.parse(value+'T00:00:00Z');
    return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===value;
  }
  function validObservation(value){
    return typeof value==='string'&&validDate(value.slice(0,10))&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)&&Number.isFinite(Date.parse(value));
  }
  function ownRankingUrl(value){
    const safe=safeHref(value);if(!safe)return false;
    try{const u=new URL(safe);return (u.hostname==='kozhaclinic.ru'||u.hostname.endsWith('.kozhaclinic.ru'))&&
      ![...u.searchParams.keys()].some(k=>/^(?:key|api_?key|token|access_?token|authorization|user)$/i.test(k));}catch{return false;}
  }
  function validateSnapshot(snap,{complete=false}={}){
    if(!snap||!validDate(snap.date)||!Array.isArray(snap.rows)||new Set(snap.rows.map(r=>r.id)).size!==snap.rows.length)throw Error('Некорректный или повторный замер.');
    if(complete&&!snap.rows.length)throw Error('Пустой срез позиций.');
    const queries=new Set();
    for(const row of snap.rows){
      if(typeof row.id!=='string'||!row.id||typeof row.query!=='string'||!row.query.trim()||typeof row.direction!=='string')throw Error('Некорректный запрос замера.');
      const key=normalizeQuery(row.query);if(queries.has(key))throw Error('Повторные запросы API.');queries.add(key);
      if(row.cohorts!==undefined&&(!Array.isArray(row.cohorts)||new Set(row.cohorts).size!==row.cohorts.length||row.cohorts.some(c=>!['base','september','october'].includes(c))))throw Error('Некорректный набор запросов.');
      for(const e of ENGINES){
        if(row[e]!==undefined&&!measured(row[e]))throw Error('Некорректная позиция API.');
        if(complete&&!measured(row[e]))throw Error('Неполный срез позиций.');
        const meta=snap.engines?.[e],depth=typeof snap.depth==='object'?snap.depth?.[e]:snap.depth;
        if(typeof row[e]==='number'&&((depth!==undefined&&row[e]>depth)||(meta&&row[e]>meta.depth)))throw Error('Позиция превышает глубину замера.');
        if(row.urls?.[e]!==undefined&&(!ownRankingUrl(row.urls[e])||typeof row[e]!=='number'))throw Error('Некорректный URL результата.');
        if(complete&&typeof row[e]==='number'&&!ownRankingUrl(row.urls?.[e]))throw Error('Нет URL найденной страницы.');
      }
    }
    if(snap.engines!==undefined){
      const times=[];
      for(const e of ENGINES){
        const m=snap.engines[e];
        if(!m||['sourceLabel','method','region','device','language'].some(k=>typeof m[k]!=='string'||!m[k].trim())||
          !((Number.isInteger(m.regionId)&&m.regionId>0)||(typeof m.regionId==='string'&&/^[1-9]\d*$/.test(m.regionId)))||
          !Number.isInteger(m.depth)||m.depth<1||m.depth>100||!validObservation(m.observedFrom)||!validObservation(m.observedTo)||
          Date.parse(m.observedFrom)>Date.parse(m.observedTo))throw Error('Некорректные условия замера.');
        if(m.sourceLabel!==snap.sourceLabel||m.region!==snap.region||
          (snap.regionIndexes?.[e]!==undefined&&String(snap.regionIndexes[e])!==String(m.regionId)))throw Error('Условия замера не согласованы с подписью.');
        if(typeof snap.depth==='object'&&snap.depth[e]!==m.depth)throw Error('Глубина замера не согласована.');
        times.push(Date.parse(m.observedFrom),Date.parse(m.observedTo));
      }
      if(Math.max(...times)-Math.min(...times)>DAY)throw Error('Окно сбора позиций превышает 24 часа.');
    }else if(complete)throw Error('Нет условий замера XMLStock.');
  }
  function validateTraffic(traffic){
    if(!traffic||['sourceLabel','metric','attribution'].some(k=>typeof traffic[k]!=='string'||!traffic[k].trim())||
      !validDate(traffic.observedFrom)||!validDate(traffic.observedTo)||!Array.isArray(traffic.weeks)||!traffic.weeks.length||!Array.isArray(traffic.comparisons)||!traffic.comparisons.length)throw Error('Некорректные данные трафика.');
    const values=v=>{
      if(['total','google','yandex','other'].some(k=>!Number.isSafeInteger(v[k])||v[k]<0)||v.total!==v.google+v.yandex+v.other)throw Error('Не сходится состав поискового трафика.');
    };
    let previous=null;
    for(const week of traffic.weeks){
      if(!validDate(week.start)||!validDate(week.end)||Date.parse(week.end)-Date.parse(week.start)!==6*DAY||new Date(week.start+'T00:00:00Z').getUTCDay()!==1||
        (previous&&Date.parse(week.start)-Date.parse(previous.end)!==DAY))throw Error('Неполные или повторные недели трафика.');
      values(week);previous=week;
    }
    if(traffic.observedFrom!==traffic.weeks[0].start||traffic.observedTo!==traffic.weeks.at(-1).end)throw Error('Период трафика не согласован.');
    const ids=new Set();
    for(const comparison of traffic.comparisons){
      if(typeof comparison.id!=='string'||!comparison.id||ids.has(comparison.id)||typeof comparison.label!=='string')throw Error('Некорректное сравнение трафика.');ids.add(comparison.id);
      const durations=[];
      for(const period of [comparison.before,comparison.after]){
        if(!period||!validDate(period.start)||!validDate(period.end)||period.start>period.end)throw Error('Некорректный период сравнения трафика.');
        values(period);
        const weeks=traffic.weeks.filter(w=>w.start>=period.start&&w.end<=period.end),days=(Date.parse(period.end)-Date.parse(period.start))/DAY+1;
        if(!weeks.length||days!==weeks.length*7||weeks[0].start!==period.start||weeks.at(-1).end!==period.end)throw Error('Период сравнения не покрыт полными неделями.');
        for(const key of ['total','google','yandex','other'])if(weeks.reduce((sum,w)=>sum+w[key],0)!==period[key])throw Error('Суммы периода не совпадают с недельными данными.');
        durations.push(days);
      }
      if(durations[0]!==durations[1]||Date.parse(comparison.after.start)-Date.parse(comparison.before.end)!==DAY)throw Error('Несопоставимые периоды трафика.');
    }
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
        if(work.details!==undefined){
          if(!Array.isArray(work.details)||!work.details.length)throw Error('Некорректные разделы описания работы.');
          for(const section of work.details){
            validateCell(section?.title);
            if(!Array.isArray(section.content)||!section.content.length)throw Error('Нет содержимого раздела работы.');
            section.content.forEach(validateDetailBlock);
          }
        }
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
        if(report.rankingHistory!==undefined){
          for(const snap of [report.rankingHistory.initial,report.rankingHistory.previous])validateSnapshot(snap);
          if(report.rankingHistory.initial.date>=report.rankingHistory.previous.date||report.rankingHistory.previous.date>=report.month+'-01')throw Error('Некорректный порядок исторических дат.');
        }
        if(report.rankings?.after) {
          if(!report.rankings.after.date.startsWith(report.month+'-')) throw Error('Замер относится к другому месяцу.');
          for(const snap of [report.rankings.before,report.rankings.after].filter(Boolean))validateSnapshot(snap);
        }
        if(report.rankingSeries!==undefined){
          if(!Array.isArray(report.rankingSeries))throw Error('Некорректные серии позиций.');
          const seriesIds=new Set();
          for(const series of report.rankingSeries){
            if(!series||typeof series.id!=='string'||!series.id||series.id==='topvisor'||seriesIds.has(series.id)||typeof series.label!=='string'||!series.label.trim()||!series.after)throw Error('Некорректная серия позиций.');seriesIds.add(series.id);
            for(const snap of [series.before,series.after].filter(Boolean))validateSnapshot(snap,{complete:true});
          }
        }
        if(report.traffic!==undefined)validateTraffic(report.traffic);
      } else throw Error('Неизвестный вид отчёта.');
    }
    if(!months.has(data.project.defaultMonth)) throw Error('Нет текущего месяца.');
    return true;
  }
  return {ENGINES,validMonth,monthLabel,safeHref,getReport,defaultMonth,readRoute,workDetailsEnabled,sliceCell,proseBlocks,change,rankingsView,scopedRankingsView,clientTimelineView,selectRankingSeries,rankingSeriesOptions,filterRankingPopulation,archiveRows,filterRows,validateData,comparableSnapshots,comparableEngine,rankBand,groupIndex,validateSnapshot,validateTraffic,ownRankingUrl};
});
