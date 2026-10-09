(() => {
  'use strict';
  const M=window.ReportModel, data=window.REPORT_DATA;
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  if(!M||!data){$('panel-results').innerHTML='<p class="notice">Не удалось загрузить отчёт. Обновите страницу.</p>';return;}
  try{M.validateData(data);}catch{$('panel-results').innerHTML='<p class="notice">Не удалось открыть данные отчёта. Обратитесь к автору отчёта.</p>';return;}
  const tabs=['results','works'], engines=M.ENGINES;
  const months=data.reports.map(r=>r.month);
  const state={...M.readRoute(data,location.href),filters:{search:'',direction:'',trend:'all'},limit:25,engine:'yandex'};
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
  let report=null,view=null,rows=[],renderedMonth=null,lastOpener=null,currentDetail=null;
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
  function apiMetricHTML(engine,top){
    const stats=view.stats[engine],metric=stats['top'+top];
    if(!stats.total)return `<div class="engine-kpi-metric"><h4>Топ-${top}</h4><p>Нет данных</p></div>`;
    const before=metric.before,after=metric.after,trend=before===null||before===after?'neutral':after>before?'positive':'negative';
    return `<div class="engine-kpi-metric"><h4>Топ-${top}</h4><div class="kpi-values">${before===null?'':`<div><span class="kpi-period">Было</span><span class="number before">${number(before)}</span></div>${icon('arrow','kpi-arrow')}`}<div>${before===null?'':'<span class="kpi-period">Стало</span>'}<span class="number ${trend}">${number(after)}</span></div></div><p class="kpi-count">из ${stats.total} запросов · ${number(after/stats.total*100)}%</p></div>`;
  }
  function kpisHTML(){
    return `<div class="engine-kpi-grid">${engines.map(e=>`<section class="engine-kpi-card surface engine-${e}"><h3 class="searcher-name">${e==='yandex'?'Яндекс':'Google'}</h3><div class="engine-kpi-metrics">${report.kind==='archive'?report.metrics[e].map(archiveMetricHTML).join(''):[10,3].map(t=>apiMetricHTML(e,t)).join('')}</div>${report.kind!=='archive'&&view.stats[e].newCount?`<p class="kpi-count">Новые запросы: ${view.stats[e].newCount}. Показаны в таблице, отдельно от сравнения.</p>`:''}</section>`).join('')}</div>`;
  }
  function chartsHTML(){
    const archive=report.kind==='archive';
    const pct=c=>{const m=c.text.match(/(-?\d+(?:[,.]\d+)?)\s*%/);return m?Number(m[1].replace(',','.')):null;};
    const pairs=Object.fromEntries(engines.map(e=>[e,[3,10].map(top=>{
      if(!archive)return {top,...view.stats[e]['top'+top]};
      const m=report.metrics[e].find(m=>m.top===top);
      return {top,before:pct(m.before),after:pct(m.after)};
    })]));
    const max=Math.max(1,...Object.values(pairs).flatMap(p=>p.flatMap(m=>[m.before,m.after]).filter(v=>v!==null)));
    return `<div class="charts-grid">${engines.map(e=>{
      const title=`<h3>${e==='yandex'?'Яндекс':'Google'}</h3>`;
      if(!archive&&!view.stats[e].total)return `<section class="ranking-chart surface">${title}<p class="chart-placeholder">Нет данных</p></section>`;
      const compared=archive||view.stats[e].comparable;
      return `<section class="ranking-chart surface">${title}<div class="rank-bars">${pairs[e].map(m=>`<div class="rank-bar-group">${['before','after'].map(s=>m[s]===null?'':`<div class="rank-bar ${s}" style="height:${Math.max(0,m[s])/max*104}px"><span>${number(m[s])}${archive?'%':''}</span></div>`).join('')}<strong>Топ-${m.top}</strong></div>`).join('')}</div><div class="chart-legend">${compared?`<span><i class="before-key"></i>Было${!archive&&view.before?' · '+date(view.before.date):''}</span>`:''}<span><i></i>${compared?'Стало':'Сейчас'}${!archive?' · '+date(view.after.date):''}</span></div></section>`;
    }).join('')}</div>`;
  }
  function dateHTML(label){
    const parts=label.match(/^(\d{1,2}\.\d{1,2}\.)(\d{4})$/);
    return parts?`<span class="rank-date"><span>${esc(parts[1])}</span><small>${parts[2]}</small></span>`:esc(label);
  }
  function tableHTML(){
    const archive=report.kind==='archive';
    const headers=archive?report.positions.headers:Object.fromEntries(engines.map(e=>[e,view.before?[date(view.before.date),date(view.after.date),'Изменение']:[date(view.after.date)]]));
    const directions=[...new Set(rows.map(r=>r.direction).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru'));
    const currentIndex=e=>archive?headers[e].length-1:view.before?1:0;
    const columns=engines.map(e=>headers[e].map((h,i)=>`<th scope="col" id="rank-${e}-${i}" class="engine-${e} period-heading ${i===0?'engine-start':''} ${i===currentIndex(e)?'current':''}">${h==='Изменение'?'<span class="rank-change-label" aria-hidden="true">Изм.</span><span class="sr-only">Изменение</span>':dateHTML(h)}</th>`).join('')).join('');
    const dirs=`<div class="filter-field"><label for="direction-filter">Направление</label><div class="select-wrap"><select id="direction-filter"><option value="">Все направления</option>${directions.map(d=>`<option value="${esc(d)}" ${d===state.filters.direction?'selected':''}>${esc(d)}</option>`).join('')}${rows.some(r=>!r.direction)?'<option value="__unmapped">Группа не найдена</option>':''}</select>${icon('chevron')}</div></div>`;
    const trends=`<div class="filter-field"><label for="trend-filter">Динамика в любом поисковике</label><div class="select-wrap"><select id="trend-filter">${[['all','Все изменения'],['up','Рост'],['down','Снижение'],['same','Без изменений'],['new','Новые запросы']].map(([v,l])=>`<option value="${v}" ${v===state.filters.trend?'selected':''}>${l}</option>`).join('')}</select>${icon('chevron')}</div></div>`;
    const legend=`<div class="rank-legend" aria-label="Цвет позиций в поиске"><span class="legend-title">Позиции:</span><span><i class="legend-swatch rank-top3" aria-hidden="true"></i>1–3</span><span><i class="legend-swatch rank-top10" aria-hidden="true"></i>4–10</span><span><i class="legend-swatch rank-other" aria-hidden="true"></i>11+</span></div>`;
    return `<section class="queries-card surface"><div class="section-heading"><h2>Позиции запросов</h2><p id="query-total">Запросов: ${rows.length}</p></div><div class="table-filters"><div class="filter-field search"><label for="query-search">Найти запрос</label><input id="query-search" type="search" placeholder="Например, лазерная эпиляция" value="${esc(state.filters.search)}"></div>${dirs}${trends}</div><div class="rank-tools"><div class="mobile-engine" role="group" aria-label="Поисковик в таблице">${engines.map(e=>`<button type="button" data-engine="${e}" aria-pressed="${state.engine===e}">${e==='yandex'?'Яндекс':'Google'}</button>`).join('')}</div>${legend}<button type="button" class="filter-reset" id="reset-filters" hidden>Сбросить фильтры</button></div><div class="table-scroll positions-scroll" id="positions-wrap" data-engine="${state.engine}" role="region" tabindex="0" aria-label="Позиции запросов"><table class="positions-table ${archive?'archive-positions':''}"><caption class="sr-only">Позиции запросов за ${M.monthLabel(state.month).toLowerCase()}</caption><colgroup><col class="query-col">${engines.map(e=>headers[e].map(()=>`<col class="rank-col engine-${e}">`).join('')).join('')}</colgroup><thead><tr><th rowspan="2" scope="col" class="query-heading">Запрос</th>${engines.map(e=>`<th id="engine-${e}" colspan="${headers[e].length}" scope="colgroup" class="engine-${e} engine-title engine-start">${e==='yandex'?'Яндекс':'Google'}</th>`).join('')}</tr><tr>${columns}</tr></thead><tbody id="query-rows"></tbody></table></div><p id="query-empty" class="query-empty" hidden>Запросы не найдены. Измените поиск или сбросьте фильтры.</p><div class="table-footer"><span id="query-count" role="status" aria-live="polite"></span><button class="button-secondary" type="button" id="show-more">Показать ещё 25</button></div>${archive?'':'<p class="table-method">«—» - сайт не найден в результатах проверки. «Нет замера» - измерение отсутствует. Динамика рассчитана по запросам, проверенным в обоих срезах.</p>'}</section>`;
  }
  function rankHTML(value,cell){
    const band=M.rankBand(value);
    const content=cell?cellHTML(cell):value===undefined?'<span class="rank-no-measure">Нет замера</span>':value===null?'<span title="Сайт не найден в результатах проверки">—</span>':number(value);
    return `<span class="rank-value rank-${band}">${content}</span>`;
  }
  function deltaHTML(c){
    if(['up','down'].includes(c.kind))return `<span class="delta ${c.kind==='up'?'positive':'negative'}"><span aria-hidden="true">${icon(c.kind)}${number(c.amount)}</span><span class="sr-only">${c.kind==='up'?'Рост':'Снижение'} на ${c.amount}</span></span>`;
    const labels={appeared:['Появился','Нов.'],lost:['За пределами проверки','Вне'],same:['Без изменений','0'],no_data:['Нет сопоставимых замеров','—']};
    const [label,short]=labels[c.kind];
    return `<span class="delta ${c.kind==='appeared'?'positive':c.kind==='lost'?'negative':'neutral'}" title="${label}"><span aria-hidden="true">${short}</span><span class="sr-only">${label}</span></span>`;
  }
  function renderQueries({resetScroll=false}={}){
    if(!$('query-rows'))return;
    const filtered=M.filterRows(rows,state.filters),visible=filtered.slice(0,state.limit),archive=report.kind==='archive';
    $('query-rows').innerHTML=visible.map(r=>{
      const qid='query-'+r.id;
      const query=`<th scope="row" id="${esc(qid)}" class="query-cell">${archive?cellHTML(r.queryCell):esc(r.query)}${r.googleQueryCell?`<span class="query-direction">Google: ${cellHTML(r.googleQueryCell)}</span>`:''}${r.direction?`<span class="query-direction">${esc(r.direction)}</span>`:''}</th>`;
      const cells=engines.map(e=>{
        const values=archive?r[e]:view.before?[r[e].before,r[e].after,r[e].change]:[r[e].after];
        const currentIndex=archive?values.length-1:view.before?1:0;
        return values.map((v,i)=>`<td headers="${esc(qid)} engine-${e} rank-${e}-${i}" class="engine-${e} ${i===0?'engine-start':''} ${i===currentIndex?'current':''}">${!archive&&i===2?deltaHTML(v):archive?rankHTML(v.text,v):rankHTML(v)}</td>`).join('');
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
      view=null;rows=M.archiveRows(report,data.keywordGroups);
      const split=report.intro.at(-1)?.row||0;
      return `<div class="results-heading"><h2>${cellHTML(report.title)}</h2>${blocksHTML(report.intro,report.images.filter(i=>i.row<=split+1))}</div>${kpisHTML()}${chartsHTML()}<div class="archive-notes">${blocksHTML(report.afterMetrics,report.images.filter(i=>i.row>split+1&&i.row<report.positionsStartRow))}</div>${tableHTML()}${report.images.filter(i=>i.row>report.positionsStartRow).map(imageHTML).join('')}`;
    }
    view=M.rankingsView(report.rankings);rows=view?.rows||[];
    if(!view)return pendingHTML('results');
    return `<div class="results-heading"><h2>Результаты за ${M.monthLabel(state.month).toLowerCase()}</h2><p class="source-label">Топвизор · ${esc(view.after.region)} · ${esc(view.after.device)} · ${date(view.after.date)}</p>${proseHTML(report.intro)}</div>${kpisHTML()}${view.before&&!view.comparable?'<p class="metrics-note">Настройки замеров различаются. Изменения позиций не сравниваем.</p>':''}${view.before&&view.comparable?chartsHTML():''}${tableHTML()}`;
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
    $('detail-body').innerHTML=`<div class="actual-result">${[['Что сделали',work.description],['Для чего это нужно',work.why],['Материалы',work.attachment]].filter(([,c])=>c.text).map(([h,c])=>`<section class="detail-section"><h3>${h}</h3>${proseHTML([c])}</section>`).join('')}${(work.evidence||[]).map(imageHTML).join('')}</div>`;
    if(!dialog.open){dialog.showModal();document.body.classList.add('dialog-open');}
    $('detail-body').scrollTop=0;$('close-detail').focus({preventScroll:true});currentDetail=work.id;
  }
  function render(){
    report=M.getReport(data,state.month);$('report-month').value=state.month;
    if(renderedMonth!==state.month){$('panel-results').innerHTML=resultsHTML();$('panel-works').innerHTML=worksHTML();renderedMonth=state.month;}
    for(const t of tabs){$('tab-'+t).setAttribute('aria-selected',String(t===state.tab));$('tab-'+t).tabIndex=t===state.tab?0:-1;$('panel-'+t).hidden=t!==state.tab;}
    $('work-count').textContent=report.works.length;$('work-count').hidden=!report.works.length;
    document.title=`Отчёт по продвижению сайта «Кожа» - ${M.monthLabel(state.month)}`;
    renderQueries();renderDetail();
  }
  function navigate(next,{replace=false,focus=false}={}){
    if(next.month&&next.month!==state.month){state.filters={search:'',direction:'',trend:'all'};state.limit=25;}
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
    if(e.target.closest('#reset-filters')){state.filters={search:'',direction:'',trend:'all'};state.limit=25;$('query-search').value='';$('direction-filter').value='';$('trend-filter').value='all';renderQueries({resetScroll:true});$('query-search').focus({preventScroll:true});return;}
    if(e.target.closest('#show-more')){state.limit+=25;renderQueries();}
  });
  document.addEventListener('input',e=>{if(e.target.id==='query-search'){state.filters.search=e.target.value;state.limit=25;renderQueries({resetScroll:true});}});
  document.addEventListener('change',e=>{if(e.target.id==='direction-filter')state.filters.direction=e.target.value;else if(e.target.id==='trend-filter')state.filters.trend=e.target.value;else return;state.limit=25;renderQueries({resetScroll:true});});
  $('close-detail').addEventListener('click',()=>navigate({detail:null}));
  dialog.addEventListener('cancel',e=>{e.preventDefault();navigate({detail:null});});
  dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)navigate({detail:null});}});
  const restore=()=>{const next=M.readRoute(data,location.href);if(next.month!==state.month){state.filters={search:'',direction:'',trend:'all'};state.limit=25;}Object.assign(state,next);render();};
  window.addEventListener('popstate',restore);window.addEventListener('hashchange',restore);
  navigate({}, {replace:true});
})();
