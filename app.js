(() => {
  'use strict';
  const M=window.ReportModel, data=window.REPORT_DATA;
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  if(!M||!data){$('panel-results').innerHTML='<p class="notice">Не удалось загрузить отчёт. Обновите страницу.</p>';return;}
  try{M.validateData(data);}catch{$('panel-results').innerHTML='<p class="notice">Не удалось открыть данные отчёта. Обратитесь к автору отчёта.</p>';return;}
  const tabs=['results','works'], engines=M.ENGINES;
  const months=data.reports.map(r=>r.month);
  const state={...M.readRoute(data,location.href),filters:{search:'',direction:'',trend:'all'},limit:25,engine:'yandex',seriesId:null,cohort:'all',trafficWeek:null,trafficVisible:new Set(['total','google','yandex','other'])};
  const number=v=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1}).format(v);
  const date=v=>v?new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric',timeZone:'UTC'}).format(new Date(v+'T12:00:00Z')):'';
  const icon=(name,cls='')=>`<svg class="${cls}" aria-hidden="true" viewBox="0 0 24 24">${{
    arrow:'<path d="M5 12h14m-5-5 5 5-5 5"/>',chevron:'<path d="m9 5 7 7-7 7"/>',external:'<path d="M7 17 17 7M7 7h10v10"/>',
    chart:'<path d="M4 3v17h17M9 15v-4m5 4V6m5 9V9"/>',work:'<rect x="5" y="5" width="14" height="16" rx="2"/><path d="M9 5V3h6v2m-6 6h6m-6 5h6"/>',
    up:'<path d="M12 20V4m-6 6 6-6 6 6"/>',down:'<path d="M12 4v16m-6-6 6 6 6-6"/>'
  }[name]||''}</svg>`;
  function cellHTML(cell){
    if(!cell) return '';
    const text=typeof cell==='string'?{text:cell}:cell;
    function run(r){
      let html=esc(r.text);
      if(r.bold)html=`<strong>${html}</strong>`;
      if(r.italic)html=`<em>${html}</em>`;
      if(r.underline)html=`<u>${html}</u>`;
      const url=M.safeHref(r.url || (/^https?:\/\/\S+$/.test(r.text)?r.text:''));
      if(url)html=`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${html}</a>`;
      return html;
    }
    return `<span class="source-text">${text.runs?text.runs.map(run).join(''):run(text)}</span>`;
  }
  function imageHTML(img){
    const url=M.safeHref(img.path);
    return url?`<figure class="archive-image"><a href="${esc(url)}" target="_blank" rel="noopener noreferrer"><img src="${esc(url)}" width="${esc(img.width)}" height="${esc(img.height)}" alt="${esc(img.alt)}" loading="lazy"></a></figure>`:'';
  }
  function blocksHTML(blocks,images=[]){
    const items=[...blocks.map(b=>({row:b.row,cells:b.cells})),...images.map(i=>({row:i.row,image:i}))].sort((a,b)=>a.row-b.row);
    let cells=[],html='';
    for(const item of items){
      if(item.image){html+=proseHTML(cells)+imageHTML(item.image);cells=[];}
      else cells.push(...item.cells);
    }
    return html+proseHTML(cells);
  }
  function proseHTML(cells){
    return `<div class="report-prose">${M.proseBlocks(cells).map(block=>block.type==='p'?`<p>${cellHTML(block.cell)}</p>`:`<${block.type}${block.type==='ol'?` start="${esc(block.start)}"`:''}>${block.items.map(item=>`<li${block.type==='ol'?` value="${esc(item.value)}"`:''}>${cellHTML(item.cell)}</li>`).join('')}</${block.type}>`).join('')}</div>`;
  }
  function detailContentHTML(blocks){
    let text=[],html='';
    for(const block of blocks){
      if(!block.table){text.push(block);continue;}
      const t=block.table;
      html+=proseHTML(text);text=[];
      html+=`<table class="detail-comparison"><caption class="sr-only">${cellHTML(t.caption)}</caption><thead><tr>${t.headers.map(c=>`<th scope="col">${cellHTML(c)}</th>`).join('')}</tr></thead><tbody>${t.rows.map(row=>`<tr>${row.map((c,i)=>i===0?`<th scope="row">${cellHTML(c)}</th>`:`<td>${cellHTML(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    }
    return html+proseHTML(text);
  }
  let report=null,view=null,rows=[],rankingPair=null,populationRows=[],renderedMonth=null,lastOpener=null,currentDetail=null;
  const dialog=$('detail-dialog');
  function pendingHTML(kind){
    const label=M.monthLabel(state.month).toLowerCase();
    const results=kind==='results';
    const previous=data.reports.filter(r=>r.month<state.month&&(r.kind==='archive'||r.rankings?.after)).at(-1);
    return `<div class="empty-state surface"><div class="empty-symbol">${icon(results?'chart':'work')}</div><div><h2>${results?'Результаты':'Работы'} за ${esc(label)} ещё не добавлены</h2>${results&&report.latestCheck?`<p class="pending-last-check">Последняя проверка позиций: ${date(report.latestCheck)}.</p>`:''}${results&&previous?`<button class="button-primary" type="button" data-month="${previous.month}">Открыть ${M.monthLabel(previous.month,false).toLowerCase()}${icon('arrow')}</button>`:''}</div></div>`;
  }
  function archiveMetricHTML(metric){
    const part=c=>{const cut=c.text.indexOf(':');return {prefix:cut>=0?c.text.slice(0,cut):'',value:cut>=0?c.text.slice(cut+1).trim():c.text};};
    const before=part(metric.before),after=part(metric.after);
    return `<div class="engine-kpi-metric"><h4 title="${esc(metric.title)}">Топ-${metric.top}</h4><div class="kpi-values"><div><span class="kpi-period">${esc(before.prefix)}</span><span class="number before">${esc(before.value)}</span></div>${icon('arrow','kpi-arrow')}<div><span class="kpi-period">${esc(after.prefix)}</span><span class="number neutral">${esc(after.value)}</span></div></div><p class="kpi-count">${cellHTML(metric.delta)}</p></div>`;
  }
  function kpisHTML(){
    if(report.kind==='archive')return `<div class="engine-kpi-grid">${engines.map(e=>`<section class="engine-kpi-card surface engine-${e}"><h3 class="searcher-name">${e==='yandex'?'Яндекс':'Google'}</h3><div class="engine-kpi-metrics">${report.metrics[e].map(archiveMetricHTML).join('')}</div></section>`).join('')}</div>`;
    return `<div class="engine-kpi-grid client-kpi-grid">${engines.map(e=>`<section class="engine-kpi-card surface engine-${e}"><h3 class="searcher-name">${e==='yandex'?'Яндекс':'Google'}</h3><table class="client-kpi-table"><thead><tr><th scope="col"><span class="sr-only">Показатель</span></th>${view.timeline.dates.map((d,i)=>`<th scope="col" class="${i===2?'current':''}">${dateHTML(date(d))}</th>`).join('')}</tr></thead><tbody>${[3,10].map(top=>`<tr><th scope="row">Топ-${top}</th>${view.timeline.stats[e]['top'+top].map((value,i)=>`<td class="${i===2?'current':''}">${number(value)}</td>`).join('')}</tr>`).join('')}</tbody></table><p class="kpi-count">из ${rows.length} запросов</p></section>`).join('')}</div>`;
  }
  function chartsHTML(){
    const archive=report.kind==='archive';
    if(!archive){
      const maximum=Math.max(1,...engines.flatMap(e=>[3,10].flatMap(top=>view.timeline.stats[e]['top'+top])));
      return `<div class="charts-grid client-timeline-charts">${engines.map(e=>`<section class="ranking-chart surface"><h3>${e==='yandex'?'Яндекс':'Google'}</h3><div class="rank-bars">${[3,10].map(top=>`<div class="rank-bar-group">${view.timeline.stats[e]['top'+top].map((value,i)=>`<div class="rank-bar timeline-${i}" style="height:${value/maximum*104}px"><span>${number(value)}</span></div>`).join('')}<strong>Топ-${top}</strong></div>`).join('')}</div><div class="chart-legend">${view.timeline.dates.map((d,i)=>`<span><i class="timeline-${i}"></i>${date(d)}</span>`).join('')}</div></section>`).join('')}</div>`;
    }
    const pct=c=>{const m=c.text.match(/(-?\d+(?:[,.]\d+)?)\s*%/);return m?Number(m[1].replace(',','.')):null;};
    const pairs=Object.fromEntries(engines.map(e=>[e,[3,10].map(top=>{
      const m=report.metrics[e].find(m=>m.top===top);
      return {top,before:pct(m.before),after:pct(m.after)};
    })]));
    const max=Math.max(1,...Object.values(pairs).flatMap(p=>p.flatMap(m=>[m.before,m.after]).filter(v=>v!==null)));
    return `<div class="charts-grid">${engines.map(e=>{
      const title=`<h3>${e==='yandex'?'Яндекс':'Google'}</h3>`;
      return `<section class="ranking-chart surface">${title}<div class="rank-bars">${pairs[e].map(m=>`<div class="rank-bar-group">${['before','after'].map(s=>m[s]===null?'':`<div class="rank-bar ${s}" style="height:${Math.max(0,m[s])/max*104}px"><span>${number(m[s])}%</span></div>`).join('')}<strong>Топ-${m.top}</strong></div>`).join('')}</div><div class="chart-legend"><span><i class="before-key"></i>Было</span><span><i></i>Стало</span></div></section>`;
    }).join('')}</div>`;
  }
  function refreshRankingView(){
    rankingPair=M.selectRankingSeries(report,state.seriesId);
    if(!rankingPair){view=null;rows=[];populationRows=[];return;}
    state.seriesId=rankingPair.id;
    const all=M.rankingsView(rankingPair)?.rows||[];
    populationRows=M.filterRankingPopulation(all,{cohort:state.cohort});
    view=M.clientTimelineView(report,rankingPair,{cohort:state.cohort,direction:state.filters.direction,search:state.filters.search});
    rows=view?.rows||[];
    state.filters.trend='all';
  }
  function monitoringControlsHTML(){
    const all=M.rankingsView(rankingPair)?.rows||[];
    const scopes=[['all','Все запросы',all.length],['base','Базовые',all.filter(r=>r.cohorts?.includes('base')||!r.cohorts?.length).length],['september','Сентябрь',all.filter(r=>r.cohorts?.includes('september')||r.direction==='Сентябрь 2026').length],['october','Октябрь',all.filter(r=>r.cohorts?.includes('october')).length]].filter(([id,,count])=>count>0&&(id!=='base'||count<all.length));
    return `<section class="monitoring-controls client-monitoring-controls surface" aria-label="Набор запросов"><div class="filter-field"><label for="ranking-cohort">Набор запросов</label><div class="select-wrap"><select id="ranking-cohort">${scopes.map(([id,label,count])=>`<option value="${id}" ${id===state.cohort?'selected':''}>${label} — ${count}</option>`).join('')}</select>${icon('chevron')}</div></div></section>`;
  }
  function rankingPanelsHTML(){
    return `<div id="ranking-kpis">${kpisHTML()}</div><div id="ranking-charts">${chartsHTML()}</div>`;
  }
  function updateRankingPopulation(){
    refreshRankingView();
    if(!view)return;
    $('ranking-kpis').innerHTML=kpisHTML();$('ranking-charts').innerHTML=chartsHTML();
    renderQueries({resetScroll:true});
  }

  const trafficSeries=[['total','Все поисковики','#5953cf'],['google','Google','#1b5fbc'],['yandex','Яндекс','#bd2f1b'],['other','Другие поисковики','#64748b']];
  function trafficChange(before,after){
    const difference=after-before,cls=difference>0?'positive':difference<0?'negative':'neutral';
    const absolute=(difference>0?'+':'')+number(difference),percent=before>0?`${difference>0?'+':''}${number(difference/before*100)}%`:'нет базы для процента';
    return `<span class="traffic-delta ${cls}">${absolute} <small>(${percent})</small></span>`;
  }
  function trafficHTML(){
    const traffic=report.traffic;
    if(!traffic?.weeks?.length)return '';
    return `<section class="organic-traffic" aria-labelledby="organic-title"><div class="traffic-section-heading"><h2 id="organic-title">Поисковый трафик</h2></div><div class="traffic-comparisons">${traffic.comparisons.map(c=>`<section class="traffic-period-card surface"><h3>${esc(({'four-weeks':'4 недели','twelve-weeks':'12 недель'})[c.id]||c.label)}</h3><p class="traffic-periods"><span><b>Было:</b> ${date(c.before.start)} — ${date(c.before.end)}</span><span><b>Стало:</b> ${date(c.after.start)} — ${date(c.after.end)}</span></p><table class="traffic-comparison-table"><caption class="sr-only">${esc(c.label)}: визиты из поисковых систем</caption><thead><tr><th scope="col">Поисковик</th><th scope="col">Было</th><th scope="col">Стало</th><th scope="col">Изменение</th></tr></thead><tbody>${trafficSeries.map(([key,label])=>`<tr ${key==='total'?'class="traffic-total"':''}><th scope="row">${label}</th><td>${number(c.before[key])}</td><td>${number(c.after[key])}</td><td>${trafficChange(c.before[key],c.after[key])}</td></tr>`).join('')}</tbody></table></section>`).join('')}</div><section class="traffic-trend-card surface" aria-labelledby="traffic-trend-title"><h3 id="traffic-trend-title">Визиты из поиска по неделям</h3><p class="traffic-chart-caption">${date(traffic.observedFrom)} — ${date(traffic.observedTo)}</p><div class="traffic-series-controls" role="group" aria-label="Линии графика">${trafficSeries.map(([key,label,color])=>`<button type="button" data-traffic-series="${key}" aria-pressed="${state.trafficVisible.has(key)}" style="--series-color:${color}"><i aria-hidden="true"></i>${label}</button>`).join('')}</div><div id="traffic-plot"></div><input id="traffic-week" class="traffic-week-range" type="range" min="0" max="${traffic.weeks.length-1}" step="1" value="${traffic.weeks.length-1}" aria-label="Неделя на графике"><div id="traffic-week-readout" class="traffic-week-readout" role="status" aria-live="polite"></div></section></section>`;
  }
  function renderTrafficChart(){
    const weeks=report.traffic?.weeks;
    if(!weeks?.length||!$('traffic-plot'))return;
    const selected=Math.max(0,Math.min(weeks.length-1,state.trafficWeek??weeks.length-1));state.trafficWeek=selected;
    const visible=trafficSeries.filter(([key])=>state.trafficVisible.has(key)),width=window.matchMedia('(max-width:600px)').matches?600:960,height=260,left=52,right=18,top=20,bottom=42,plotWidth=width-left-right,plotHeight=height-top-bottom;
    const maximum=Math.max(20,...weeks.flatMap(w=>visible.map(([key])=>w[key]))),ceiling=Math.ceil(maximum/20)*20;
    const x=i=>left+i/(Math.max(1,weeks.length-1))*plotWidth,y=value=>top+plotHeight-value/ceiling*plotHeight;
    const ticks=[0,.25,.5,.75,1].map(part=>`<g class="traffic-grid"><line x1="${left}" x2="${width-right}" y1="${y(ceiling*part)}" y2="${y(ceiling*part)}"/><text x="${left-10}" y="${y(ceiling*part)+5}" text-anchor="end">${number(ceiling*part)}</text></g>`).join('');
    const indexes=[...new Set([0,Math.round((weeks.length-1)*.2),Math.round((weeks.length-1)*.4),Math.round((weeks.length-1)*.6),Math.round((weeks.length-1)*.8),weeks.length-1])];
    $('traffic-plot').innerHTML=`<svg class="organic-week-chart" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="organic-chart-title organic-chart-desc"><title id="organic-chart-title">Визиты из поисковых систем по полным неделям</title><desc id="organic-chart-desc">Недельные визиты. Отдельные линии: все поисковики, Google, Яндекс и другие. Значения выбранной недели доступны под графиком.</desc>${ticks}${visible.map(([key,label,color])=>`<polyline class="traffic-line" aria-label="${label}" stroke="${color}" points="${weeks.map((w,i)=>`${x(i)},${y(w[key])}`).join(' ')}"/>`).join('')}<line class="traffic-selected-week" x1="${x(selected)}" x2="${x(selected)}" y1="${top}" y2="${height-bottom}"/>${visible.map(([key,,color])=>`<circle cx="${x(selected)}" cy="${y(weeks[selected][key])}" r="4.5" fill="${color}"/>`).join('')}${indexes.map(i=>`<text class="traffic-axis-date" x="${x(i)}" y="${height-12}" text-anchor="${i===0?'start':i===weeks.length-1?'end':'middle'}">${date(weeks[i].start).slice(0,5)}</text>`).join('')}${weeks.map((w,i)=>`<rect class="traffic-week-hit" data-traffic-week="${i}" x="${x(i)-(i===0?0:plotWidth/(weeks.length-1)/2)}" y="${top}" width="${plotWidth/(weeks.length-1)}" height="${plotHeight}"><title>${date(w.start)} — ${date(w.end)}: ${number(w.total)} визитов из поиска</title></rect>`).join('')}</svg>`;
    const week=weeks[selected];
    $('traffic-week-readout').innerHTML=`<p>${date(week.start)} — ${date(week.end)}</p><dl>${trafficSeries.map(([key,label,color])=>`<div><dt><i style="background:${color}" aria-hidden="true"></i>${label}</dt><dd>${number(week[key])}</dd></div>`).join('')}</dl>`;
    $('traffic-week').value=String(selected);
    document.querySelectorAll('[data-traffic-series]').forEach(button=>button.setAttribute('aria-pressed',String(state.trafficVisible.has(button.dataset.trafficSeries))));
  }
  function dateHTML(label){
    const parts=label.match(/^(\d{1,2}\.\d{1,2}\.)(\d{4})$/);
    return parts?`<span class="rank-date"><span>${esc(parts[1])}</span><small>${parts[2]}</small></span>`:esc(label);
  }
  function tableHTML(){
    const archive=report.kind==='archive';
    const headers=Object.fromEntries(engines.map(e=>[e,archive?[...report.positions.headers[e],'Изменение']:view.timeline.dates.map(date)]));
    const directionRows=archive?rows:populationRows;
    const directions=[...new Set(directionRows.map(r=>r.direction).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru'));
    const currentIndex=e=>archive?headers[e].length-2:2;
    const columns=engines.map(e=>headers[e].map((h,i)=>`<th scope="col" id="rank-${e}-${i}" class="engine-${e} period-heading ${i===0?'engine-start':''} ${i===currentIndex(e)-1?'period-before':''} ${i===currentIndex(e)?'current':''}">${h==='Изменение'?'<span class="rank-change-label" aria-hidden="true">Изменение</span><span class="rank-change-short" aria-hidden="true">Изм.</span><span class="sr-only">Изменение</span>':dateHTML(h)}</th>`).join('')).join('');
    const dirs=`<div class="filter-field"><label for="direction-filter">Направление</label><div class="select-wrap"><select id="direction-filter"><option value="">Все направления</option>${directions.map(d=>`<option value="${esc(d)}" ${d===state.filters.direction?'selected':''}>${esc(d)}</option>`).join('')}${rows.some(r=>!r.direction)?'<option value="__unmapped">Группа не найдена</option>':''}</select>${icon('chevron')}</div></div>`;
    const trends=archive?`<div class="filter-field"><label for="trend-filter">Динамика в любом поисковике</label><div class="select-wrap"><select id="trend-filter" ${!archive&&!view.comparable?'disabled title="Нет сопоставимого замера"':''}>${[['all',!archive&&!view.comparable?'Нет сопоставимого замера':'Все изменения'],['up','Рост'],['down','Снижение'],['same','Без изменений'],['new','Новые запросы']].map(([v,l])=>`<option value="${v}" ${v===state.filters.trend?'selected':''}>${l}</option>`).join('')}</select>${icon('chevron')}</div></div>`:'';
    const legend=`<div class="rank-legend" aria-label="Цвет позиций в поиске"><span class="legend-title">Позиции:</span><span><i class="legend-swatch rank-top3" aria-hidden="true"></i>1–3</span><span><i class="legend-swatch rank-top10" aria-hidden="true"></i>4–10</span><span><i class="legend-swatch rank-other" aria-hidden="true"></i>11+</span></div>`;
    return `<section class="queries-card surface"><div class="section-heading"><h2>Позиции запросов</h2><p id="query-total">Запросов: ${rows.length}</p></div><div class="table-filters ${archive?'':'client-table-filters'}"><div class="filter-field search"><label for="query-search">Найти запрос</label><input id="query-search" type="search" placeholder="Например, лазерная эпиляция" value="${esc(state.filters.search)}"></div>${dirs}${trends}</div><div class="rank-tools"><div class="mobile-engine" role="group" aria-label="Поисковик в таблице">${engines.map(e=>`<button type="button" data-engine="${e}" aria-pressed="${state.engine===e}">${e==='yandex'?'Яндекс':'Google'}</button>`).join('')}</div>${legend}<button type="button" class="filter-reset" id="reset-filters" hidden>Сбросить фильтры</button></div><div class="table-scroll positions-scroll" id="positions-wrap" data-engine="${state.engine}" role="region" tabindex="0" aria-label="Позиции запросов"><table class="positions-table ${archive?'archive-positions':'client-timeline-positions'}"><caption class="sr-only">Позиции запросов за ${M.monthLabel(state.month).toLowerCase()}</caption><colgroup><col class="query-col">${engines.map(e=>headers[e].map(()=>`<col class="rank-col engine-${e}">`).join('')).join('')}</colgroup><thead><tr><th rowspan="2" scope="col" class="query-heading">Запрос</th>${engines.map(e=>`<th id="engine-${e}" colspan="${headers[e].length}" scope="colgroup" class="engine-${e} engine-title engine-start">${e==='yandex'?'Яндекс':'Google'}</th>`).join('')}</tr><tr>${columns}</tr></thead><tbody id="query-rows"></tbody></table></div><p id="query-empty" class="query-empty" hidden>Запросы не найдены. Измените поиск или сбросьте фильтры.</p><div class="table-footer"><span id="query-count" role="status" aria-live="polite"></span><button class="button-secondary" type="button" id="show-more">Показать ещё 25</button></div></section>`;
  }
  function rankHTML(value,cell,url){
    const displayValue=cell?value:(Number.isInteger(value)?value:101),band=M.rankBand(displayValue);
    const content=cell?cellHTML(cell):number(displayValue);
    const html=`<span class="rank-value rank-${band}">${content}</span>`;
    const href=Number.isInteger(value)&&M.safeHref(url);
    if(href&&/^https?:\/\//i.test(href)){const hostname=new URL(href).hostname;if(hostname==='kozhaclinic.ru'||hostname.endsWith('.kozhaclinic.ru'))return `<a class="rank-result-link" href="${esc(href)}" target="_blank" rel="noopener noreferrer" title="Найденная страница: ${esc(href)}">${html}${icon('external')}<span class="sr-only">Открыть найденную страницу</span></a>`;}
    return html;
  }
  function deltaHTML(c){
    if(['up','down'].includes(c.kind))return `<span class="delta ${c.kind==='up'?'positive':'negative'}"><span aria-hidden="true">${icon(c.kind)}${number(c.amount)}</span><span class="sr-only">${c.kind==='up'?'Рост':'Снижение'} на ${c.amount}</span></span>`;
    const labels={appeared:['Появился','Нов.'],lost:['За пределами','Вне'],same:['Без изменений','0'],no_data:['Нет сравнения','—']};
    const [label,short]=labels[c.kind];
    return `<span class="delta ${c.kind==='appeared'?'positive':c.kind==='lost'?'negative':'neutral'}" title="${label}"><span class="delta-full" aria-hidden="true">${label}</span><span class="delta-compact" aria-hidden="true">${short}</span><span class="sr-only">${label}</span></span>`;
  }
  function renderQueries({resetScroll=false}={}){
    if(!$('query-rows'))return;
    const archive=report.kind==='archive',filtered=archive?M.filterRows(rows,state.filters):rows,visible=filtered.slice(0,state.limit);
    $('query-rows').innerHTML=visible.map(r=>{
      const qid='query-'+r.id;
      const query=`<th scope="row" id="${esc(qid)}" class="query-cell">${archive?cellHTML(r.queryCell):esc(r.query)}${r.googleQueryCell?`<span class="query-direction">Google: ${cellHTML(r.googleQueryCell)}</span>`:''}</th>`;
      const cells=engines.map(e=>{
        const values=archive?[...r[e],r.changes[e].change]:r[e].history;
        const currentIndex=archive?values.length-2:2;
        return values.map((v,i)=>`<td headers="${esc(qid)} engine-${e} rank-${e}-${i}" class="engine-${e} ${i===0?'engine-start':''} ${i===currentIndex-1?'period-before':''} ${i===currentIndex?'current':''}">${archive&&i===values.length-1?deltaHTML(v):archive?rankHTML(v.text,v):rankHTML(v,null,i===currentIndex?r.urls?.[e]:null)}</td>`).join('');
      }).join('');
      return `<tr>${query}${cells}</tr>`;
    }).join('');
    $('positions-wrap').hidden=!filtered.length;$('query-empty').hidden=!!filtered.length;
    $('query-count').textContent=`Показано: ${visible.length} из ${filtered.length}`;
    $('query-total').textContent=filtered.length===rows.length?`Запросов: ${rows.length}`:`Найдено: ${filtered.length} из ${rows.length}`;
    $('show-more').hidden=visible.length>=filtered.length;
    $('reset-filters').hidden=!state.filters.search&&!state.filters.direction&&state.filters.trend==='all';
    if(resetScroll){$('positions-wrap').scrollTop=0;$('positions-wrap').scrollLeft=0;}
  }
  function resultsHTML(){
    if(report.kind==='archive'){
      view=null;rankingPair=null;populationRows=[];rows=M.archiveRows(report,data.keywordGroups);
      const split=report.intro.at(-1)?.row||0;
      return `<div class="results-heading"><h2>${cellHTML(report.title)}</h2>${blocksHTML(report.intro,report.images.filter(i=>i.row<=split+1))}</div>${kpisHTML()}${chartsHTML()}<div class="archive-notes">${blocksHTML(report.afterMetrics,report.images.filter(i=>i.row>split+1&&i.row<report.positionsStartRow))}</div>${tableHTML()}${report.images.filter(i=>i.row>report.positionsStartRow).map(imageHTML).join('')}`;
    }
    refreshRankingView();
    const heading=`<div class="results-heading"><h2>Результаты за ${M.monthLabel(state.month).toLowerCase()}</h2></div>`;
    if(!view)return heading+trafficHTML()+pendingHTML('results');
    return `${heading}${trafficHTML()}<div class="rankings-section-heading"><h2>Позиции в поиске</h2></div>${monitoringControlsHTML()}${rankingPanelsHTML()}${tableHTML()}`;
  }
  function worksHTML(){
    if(!report.works.length)return pendingHTML('works');
    const details=M.workDetailsEnabled(report);
    const notes=report.workNotes?.length?`<section class="surface work-notes">${proseHTML(report.workNotes)}</section>`:'';
    const attachment=w=>!details&&w.attachment?.text&&w.attachment.text!=='—'?`<p class="work-attachment">${/^https:\/\/docs\.google\.com\/spreadsheets\//.test(w.attachment.text)?`<a href="${esc(M.safeHref(w.attachment.text))}" target="_blank" rel="noopener noreferrer">Таблица связанных процедур</a>`:cellHTML(w.attachment)}</p>`:'';
    return `<div class="works-heading"><h2>${report.worksTitle?cellHTML(report.worksTitle):'Работы за '+M.monthLabel(state.month).toLowerCase()}</h2></div><section class="surface"><table class="works-table ${details?'':'archive-works'}"><thead><tr><th scope="col">Что сделали</th><th scope="col">Краткое описание</th><th scope="col">Для чего это нужно</th>${details?'<th scope="col">Подробнее</th>':''}</tr></thead><tbody>${report.works.map(w=>`<tr><td><h3 class="work-name">${cellHTML(w.title)}</h3></td><td class="work-summary">${proseHTML([w.description])}${attachment(w)}</td><td data-label="Для чего это нужно">${proseHTML([w.why])}</td>${details?`<td><button type="button" class="work-open" data-task="${esc(w.id)}" aria-label="Подробнее: ${esc(w.title.text)}">Подробнее${icon('arrow')}</button></td>`:''}</tr>`).join('')}</tbody></table></section>${notes}`;
  }
  function renderDetail(){
    const work=state.tab==='works'&&M.workDetailsEnabled(report)?report.works.find(w=>w.id===state.detail):null;
    if(!work){
      if(dialog.open){dialog.close();document.body.classList.remove('dialog-open');if(lastOpener?.isConnected)lastOpener.focus({preventScroll:true});else $('tab-'+state.tab).focus({preventScroll:true});}
      currentDetail=null;return;
    }
    if(currentDetail===work.id&&dialog.open)return;
    dialog.dataset.reportView='works';
    $('detail-title').textContent=work.title.text;$('detail-meta').hidden=true;
    const sections=work.details||[['Что сделали',work.description],['Для чего это нужно',work.why],['Материалы',work.attachment]].filter(([,c])=>c.text).map(([title,c])=>({title:{text:title},content:[c]}));
    $('detail-body').innerHTML=`<div class="actual-result">${sections.map((section,i)=>`<section class="detail-section"><h3>${cellHTML(section.title)}</h3>${detailContentHTML([...section.content,...(work.details&&i===sections.length-1&&work.attachment.text?[work.attachment]:[])])}</section>`).join('')}${(work.evidence||[]).map(imageHTML).join('')}</div>`;
    if(!dialog.open){dialog.showModal();document.body.classList.add('dialog-open');}
    $('detail-body').scrollTop=0;$('close-detail').focus({preventScroll:true});currentDetail=work.id;
  }
  function render(){
    report=M.getReport(data,state.month);$('report-month').value=state.month;
    if(renderedMonth!==state.month){$('panel-results').innerHTML=resultsHTML();$('panel-works').innerHTML=worksHTML();renderedMonth=state.month;renderTrafficChart();}
    for(const t of tabs){$('tab-'+t).setAttribute('aria-selected',String(t===state.tab));$('tab-'+t).tabIndex=t===state.tab?0:-1;$('panel-'+t).hidden=t!==state.tab;}
    $('work-count').textContent=report.works.length;$('work-count').hidden=!report.works.length;
    document.title=`Отчёт по продвижению сайта «Кожа» - ${M.monthLabel(state.month)}`;
    renderQueries();renderDetail();
  }
  function navigate(next,{replace=false,focus=false}={}){
    if(next.month&&next.month!==state.month){state.filters={search:'',direction:'',trend:'all'};state.limit=25;state.seriesId=null;state.cohort='all';state.trafficWeek=null;}
    Object.assign(state,next);
    const url=new URL(location.href);url.searchParams.set('month',state.month);url.hash=state.tab;
    if(state.detail)url.searchParams.set('task',state.detail);else url.searchParams.delete('task');
    try{history[replace?'replaceState':'pushState'](null,'',url);}catch{/* Local file viewing has no history API. */}
    render();if(focus)$('tab-'+state.tab).focus({preventScroll:true});
  }
  $('report-month').innerHTML=months.map(m=>`<option value="${m}">${M.monthLabel(m)}</option>`).join('');
  $('period-label').textContent=`${M.monthLabel(months[0])} - ${M.monthLabel(months.at(-1)).toLowerCase()}`;
  $('report-month').addEventListener('change',e=>{navigate({month:e.target.value,detail:null});$('announcement').textContent=`Выбран ${M.monthLabel(state.month)}.`;});
  tabs.forEach((tab,index)=>{
    $('tab-'+tab).addEventListener('click',()=>navigate({tab,detail:null}));
    $('tab-'+tab).addEventListener('keydown',e=>{
      if(e.ctrlKey||e.metaKey||e.altKey||!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
      e.preventDefault();const n=e.key==='Home'?0:e.key==='End'?tabs.length-1:(index+1)%tabs.length;
      navigate({tab:tabs[n],detail:null},{focus:true});
    });
  });
  document.addEventListener('click',e=>{
    if(e.target.closest('.skip-link')){e.preventDefault();$('panel-'+state.tab).focus();$('panel-'+state.tab).scrollIntoView({block:'start'});return;}
    const work=e.target.closest('[data-task]');if(work){lastOpener=work;navigate({detail:work.dataset.task});return;}
    const month=e.target.closest('button[data-month]');if(month){navigate({month:month.dataset.month,tab:'results',detail:null});return;}
    const engine=e.target.closest('button[data-engine]');if(engine){state.engine=engine.dataset.engine;$('positions-wrap').dataset.engine=state.engine;document.querySelectorAll('button[data-engine]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.engine===state.engine)));return;}
    const trafficToggle=e.target.closest('[data-traffic-series]');if(trafficToggle){const key=trafficToggle.dataset.trafficSeries;if(state.trafficVisible.has(key)){if(state.trafficVisible.size===1)return;state.trafficVisible.delete(key);}else state.trafficVisible.add(key);renderTrafficChart();return;}
    if(e.target.closest('#reset-filters')){state.filters={search:'',direction:'',trend:'all'};state.limit=25;$('query-search').value='';$('direction-filter').value='';if($('trend-filter'))$('trend-filter').value='all';if(report.kind==='archive')renderQueries({resetScroll:true});else updateRankingPopulation();$('query-search').focus({preventScroll:true});return;}
    if(e.target.closest('#show-more')){state.limit+=25;renderQueries();}
  });
  document.addEventListener('input',e=>{
    if(e.target.id==='traffic-week'){state.trafficWeek=Number(e.target.value);renderTrafficChart();return;}
    if(e.target.id==='query-search'){state.filters.search=e.target.value;state.limit=25;if(report.kind==='archive')renderQueries({resetScroll:true});else updateRankingPopulation();}
  });
  document.addEventListener('pointerover',e=>{const point=e.target.closest('[data-traffic-week]');if(point&&state.trafficWeek!==Number(point.dataset.trafficWeek)){state.trafficWeek=Number(point.dataset.trafficWeek);renderTrafficChart();}});
  document.addEventListener('change',e=>{
    if(e.target.id==='ranking-cohort'){
      state.cohort=e.target.value;
      state.filters={search:'',direction:'',trend:'all'};state.limit=25;$('panel-results').innerHTML=resultsHTML();renderQueries();renderTrafficChart();$(e.target.id).focus({preventScroll:true});return;
    }
    if(e.target.id==='direction-filter')state.filters.direction=e.target.value;
    else if(e.target.id==='trend-filter')state.filters.trend=e.target.value;
    else return;
    state.limit=25;if(report.kind==='archive'||e.target.id==='trend-filter')renderQueries({resetScroll:true});else updateRankingPopulation();
  });
  $('close-detail').addEventListener('click',()=>navigate({detail:null}));
  dialog.addEventListener('cancel',e=>{e.preventDefault();navigate({detail:null});});
  dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)navigate({detail:null});}});
  const restore=()=>{const next=M.readRoute(data,location.href);if(next.month!==state.month){state.filters={search:'',direction:'',trend:'all'};state.limit=25;state.seriesId=null;state.cohort='all';state.trafficWeek=null;}Object.assign(state,next);render();};
  window.addEventListener('popstate',restore);window.addEventListener('hashchange',restore);
  let trafficResizeFrame;
  window.addEventListener('resize',()=>{cancelAnimationFrame(trafficResizeFrame);trafficResizeFrame=requestAnimationFrame(renderTrafficChart);});
  navigate({}, {replace:true});
})();
