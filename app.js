(function(){
  var STATUSES=[
    {k:'enviada',l:'Enviada',c:'--s-sent'},
    {k:'analise',l:'Em análise',c:'--s-review'},
    {k:'entrevista',l:'Entrevista',c:'--s-interview'},
    {k:'proposta',l:'Proposta',c:'--s-offer'},
    {k:'contratado',l:'Contratado',c:'--s-hired'},
    {k:'recusada',l:'Recusada',c:'--s-rejected'},
    {k:'semresposta',l:'Sem resposta',c:'--s-ghost'}
  ];
  var ACTIVE=['enviada','analise','entrevista','proposta'];
  var DEFAULT_CVS=['MEU_CV.pdf'];
  var $=function(s){return document.querySelector(s)};
  var apps=[], settings={}, loaded=false, ready=true, filter='all', query='', editingId=null, delArmed=false, delTimer=null, toastTimer=null;
  var queue=Promise.resolve();
  function newId(){return Date.now().toString(36)+Math.random().toString(36).slice(2,7)}
  function persist(){
    return enqueue(function(){
      return fetch('/api/data',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({apps:apps,settings:settings})}).then(function(r){if(!r.ok)throw new Error('HTTP '+r.status)});
    });
  }

  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  function pad(n){return n<10?'0'+n:''+n}
  function todayStr(){var d=new Date();return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())}
  function toDate(s){var p=String(s||'').split('-');return p.length===3?new Date(+p[0],+p[1]-1,+p[2]):null}
  function fmt(s){var p=String(s||'').split('-');return p.length===3?p[2]+'/'+p[1]+'/'+p[0]:'—'}
  function daysBetween(a,b){var x=toDate(a),y=toDate(b);if(!x||!y)return 0;return Math.max(0,Math.round((y-x)/86400000))}
  function stat(k){for(var i=0;i<STATUSES.length;i++)if(STATUSES[i].k===k)return STATUSES[i];return STATUSES[0]}
  function host(u){try{return new URL(u).hostname.replace(/^www\./,'')}catch(e){return 'link'}}
  function safeUrl(u){u=String(u||'').trim();if(!u)return '';if(!/^https?:\/\//i.test(u))u='https://'+u;try{var x=new URL(u);return (x.protocol==='http:'||x.protocol==='https:')?x.href:''}catch(e){return ''}}
  function toast(msg){var t=$('#toast');t.textContent=msg;t.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(function(){t.hidden=true},3200)}
  function enqueue(fn){queue=queue.then(fn,fn);return queue}

  function startDate(){
    if(settings.startedAt)return settings.startedAt;
    var min='';apps.forEach(function(a){if(a.sentAt&&(!min||a.sentAt<min))min=a.sentAt});
    return min||todayStr();
  }
  function hasInterview(a){return !!(a.interviewAt||a.interviewNotes||['entrevista','proposta','contratado'].indexOf(a.status)>-1)}

  function render(){
    renderStats();renderChips();renderList();renderCvList();
  }
  function renderStats(){
    var n=apps.length,start=startDate(),days=daysBetween(start,todayStr());
    var active=apps.filter(function(a){return ACTIVE.indexOf(a.status)>-1}).length;
    var inter=apps.filter(hasInterview).length;
    var answered=apps.filter(function(a){return a.status!=='enviada'&&a.status!=='semresposta'}).length;
    var rate=n?Math.round(answered/n*100):0;
    $('#total').textContent=n;
    $('#m-days').textContent=days;$('#m-active').textContent=active;$('#m-int').textContent=inter;$('#m-rate').textContent=rate+'%';
    $('#sub').textContent=n?('desde '+fmt(start)):'Registre a primeira para começar a contar';
    var bar='',leg='';
    STATUSES.forEach(function(s){
      var c=apps.filter(function(a){return a.status===s.k}).length;
      if(!c)return;
      bar+='<i style="--c:var('+s.c+');flex:'+c+'" title="'+esc(s.l)+': '+c+'"></i>';
      leg+='<span style="--c:var('+s.c+')">'+esc(s.l)+' <b class="mono">'+c+'</b></span>';
    });
    $('#bar').innerHTML=bar;$('#bar').hidden=!n;$('#legend').innerHTML=leg;
    var st=$('#start');
    st.innerHTML='<span>Início da busca: <b class="mono">'+fmt(start)+'</b></span><button type="button" id="chg">alterar</button>';
    var hired=apps.filter(function(a){return a.status==='contratado'}).sort(function(a,b){return (b.hiredAt||'')<(a.hiredAt||'')?-1:1})[0];
    var h=$('#hired');
    if(hired){
      var upto=apps.filter(function(a){return a.sentAt<=hired.sentAt}).length;
      h.hidden=false;h.textContent='Vaga conseguida na '+hired.company+': '+upto+' candidaturas enviadas em '+daysBetween(start,hired.hiredAt||todayStr())+' dias de busca.';
    }else h.hidden=true;
  }
  function renderChips(){
    var html='<button class="chip" type="button" data-f="all" aria-pressed="'+(filter==='all')+'">Todas <small>'+apps.length+'</small></button>';
    STATUSES.forEach(function(s){
      var c=apps.filter(function(a){return a.status===s.k}).length;
      if(!c&&filter!==s.k)return;
      html+='<button class="chip" type="button" data-f="'+s.k+'" aria-pressed="'+(filter===s.k)+'">'+esc(s.l)+' <small>'+c+'</small></button>';
    });
    $('#chips').innerHTML=html;
  }
  function visible(){
    var q=query.trim().toLowerCase();
    return apps.filter(function(a){
      if(filter!=='all'&&a.status!==filter)return false;
      if(!q)return true;
      return [a.company,a.role,a.cv,a.source].join(' ').toLowerCase().indexOf(q)>-1;
    }).sort(function(a,b){
      if((a.sentAt||'')!==(b.sentAt||''))return (b.sentAt||'')<(a.sentAt||'')?-1:1;
      return (b.createdAt||0)-(a.createdAt||0);
    });
  }
  function renderList(){
    var el=$('#list');
    if(!ready){el.innerHTML='';return}
    if(!loaded){el.innerHTML='<div class="empty"><h2>Carregando suas candidaturas…</h2></div>';return}
    if(!apps.length){
      el.innerHTML='<div class="empty"><h2>Nenhuma candidatura registrada</h2><ol><li>Clique em “Nova candidatura” assim que enviar o CV para uma vaga.</li><li>Cole o link da vaga e informe qual arquivo de CV você mandou.</li><li>Se houver entrevista, anote as perguntas e o resultado na mesma ficha.</li></ol><button class="btn primary" type="button" data-act="new">+ Nova candidatura</button></div>';
      return;
    }
    var rows=visible();
    if(!rows.length){el.innerHTML='<div class="empty"><h2>Nada encontrado com esse filtro</h2></div>';return}
    var html='<div class="head" aria-hidden="true"><span>Empresa e cargo</span><span>Enviada</span><span>CV enviado</span><span>Status</span><span></span></div>';
    rows.forEach(function(a){
      var s=stat(a.status),u=safeUrl(a.url);
      var opts=STATUSES.map(function(x){return '<option value="'+x.k+'"'+(x.k===a.status?' selected':'')+'>'+esc(x.l)+'</option>'}).join('');
      html+='<div class="row" data-id="'+esc(a.id)+'">'
        +'<div class="co"><b>'+esc(a.company||'Sem nome')+'</b><span>'+esc(a.role||'Cargo não informado')+'</span>'
        +(u?'<a href="'+esc(u)+'" target="_blank" rel="noopener">'+esc(host(u))+' ↗</a>':'')
        +(a.interviewNotes?'<span class="tag">notas de entrevista</span>':'')+'</div>'
        +'<div class="date mono">'+fmt(a.sentAt)+'</div>'
        +'<div class="cv mono">'+esc(a.cv||'—')+'</div>'
        +'<div class="stw"><select class="pill" style="--c:var('+s.c+')" data-status-for="'+esc(a.id)+'" aria-label="Status de '+esc(a.company)+'">'+opts+'</select></div>'
        +'<button class="btn open" type="button" data-open="'+esc(a.id)+'">Abrir</button></div>';
    });
    el.innerHTML=html;
  }
  function renderCvList(){
    var seen={},out=[];
    DEFAULT_CVS.concat(apps.map(function(a){return a.cv})).forEach(function(v){v=(v||'').trim();if(v&&!seen[v]){seen[v]=1;out.push(v)}});
    $('#cvlist').innerHTML=out.map(function(v){return '<option value="'+esc(v)+'"></option>'}).join('');
  }

  /* Painel */
  function fillStatusSelect(){$('#f-status').innerHTML=STATUSES.map(function(s){return '<option value="'+s.k+'">'+esc(s.l)+'</option>'}).join('')}
  function lastCv(){var m=apps.slice().sort(function(a,b){return (b.createdAt||0)-(a.createdAt||0)})[0];return (m&&m.cv)||DEFAULT_CVS[0]}
  function openPanel(id){
    editingId=id||null;delArmed=false;$('#del').textContent='Excluir';
    var a=id?apps.filter(function(x){return x.id===id})[0]:null;
    if(id&&!a)return;
    $('#ptitle').textContent=a?(a.company||'Candidatura'):'Nova candidatura';
    $('#f-company').value=a?a.company||'':'';
    $('#f-role').value=a?a.role||'':'';
    $('#f-url').value=a?a.url||'':'';
    $('#f-sent').value=a?a.sentAt||todayStr():todayStr();
    $('#f-source').value=a?a.source||'':'';
    $('#f-cv').value=a?a.cv||'':lastCv();
    $('#f-status').value=a?a.status||'enviada':'enviada';
    $('#f-notes').value=a?a.notes||'':'';
    $('#f-idate').value=a?a.interviewAt||'':'';
    $('#f-istage').value=a?a.interviewStage||'':'';
    $('#f-inotes').value=a?a.interviewNotes||'':'';
    $('#del').hidden=!a;
    $('#overlay').hidden=false;
    setTimeout(function(){$('#f-company').focus()},30);
  }
  function closePanel(){$('#overlay').hidden=true;editingId=null}

  function submit(e){
    e.preventDefault();
    var company=$('#f-company').value.trim();
    if(!company){$('#f-company').focus();return}
    var prev=editingId?apps.filter(function(x){return x.id===editingId})[0]:null;
    var status=$('#f-status').value;
    var data={
      company:company, role:$('#f-role').value.trim(), url:safeUrl($('#f-url').value), sentAt:$('#f-sent').value||todayStr(),
      source:$('#f-source').value, cv:$('#f-cv').value.trim(), status:status, notes:$('#f-notes').value,
      interviewAt:$('#f-idate').value, interviewStage:$('#f-istage').value, interviewNotes:$('#f-inotes').value,
      createdAt:prev&&prev.createdAt?prev.createdAt:Date.now(), updatedAt:Date.now()
    };
    if(status==='contratado')data.hiredAt=(prev&&prev.hiredAt)||todayStr();
    var id=editingId;
    if(id){var idx=apps.findIndex(function(x){return x.id===id});data.id=id;if(idx>-1)apps[idx]=Object.assign({},apps[idx],data);}
    else{data.id=newId();apps.push(data);}
    $('#save').disabled=true;
    persist().then(function(){toast('Candidatura salva.');closePanel()})
      .catch(function(){toast('Não foi possível salvar. O servidor (node server.js) está rodando?')})
      .then(function(){$('#save').disabled=false;render()});
  }
  function changeStatus(id,k){
    var a=apps.filter(function(x){return x.id===id})[0];if(!a||a.status===k)return;
    a.status=k;a.updatedAt=Date.now();
    if(k==='contratado'&&!a.hiredAt)a.hiredAt=todayStr();
    render();
    persist().catch(function(){toast('Não foi possível salvar o status.')});
  }
  function removeApp(){
    if(!editingId)return;
    if(!delArmed){delArmed=true;$('#del').textContent='Confirmar exclusão';clearTimeout(delTimer);delTimer=setTimeout(function(){delArmed=false;$('#del').textContent='Excluir'},4000);return}
    var id=editingId;
    apps=apps.filter(function(x){return x.id!==id});
    render();closePanel();
    persist().then(function(){toast('Candidatura excluída.')}).catch(function(){toast('Não foi possível salvar a exclusão.')});
  }
  function editStart(){
    var st=$('#start');
    st.innerHTML='<label for="sd" style="display:inline">Início da busca</label><input id="sd" type="date" value="'+esc(startDate())+'" style="width:auto;min-height:32px"><button type="button" id="sdok">salvar</button>';
    $('#sd').focus();
  }
  function saveStart(){
    var v=$('#sd').value;if(!v){renderStats();return}
    settings.startedAt=v;renderStats();
    persist().catch(function(){toast('Não foi possível salvar a data.')});
  }
  function exportCsv(){
    var cols=[['company','Empresa'],['role','Cargo'],['url','Link'],['sentAt','Enviada em'],['source','Origem'],['cv','CV enviado'],['status','Status'],['notes','Observações'],['interviewAt','Data da entrevista'],['interviewStage','Etapa'],['interviewNotes','Obs. da entrevista']];
    function q(v){return '"'+String(v==null?'':v).replace(/"/g,'""')+'"'}
    var rows=[cols.map(function(c){return q(c[1])}).join(';')];
    visibleAll().forEach(function(a){rows.push(cols.map(function(c){return q(c[0]==='status'?stat(a.status).l:a[c[0]])}).join(';'))});
    var blob=new Blob(['\ufeff'+rows.join('\r\n')],{type:'text/csv;charset=utf-8'});
    var l=document.createElement('a');l.href=URL.createObjectURL(blob);l.download='candidaturas.csv';document.body.appendChild(l);l.click();l.remove();
  }
  function visibleAll(){return apps.slice().sort(function(a,b){return (a.sentAt||'')<(b.sentAt||'')?-1:1})}

  /* Eventos */
  $('#csv').addEventListener('click',exportCsv);
  $('#new').addEventListener('click',function(){openPanel(null)});
  $('#close').addEventListener('click',closePanel);
  $('#cancel').addEventListener('click',closePanel);
  $('#scrim').addEventListener('click',closePanel);
  $('#form').addEventListener('submit',submit);
  $('#del').addEventListener('click',removeApp);
  document.addEventListener('keydown',function(e){if(e.key==='Escape'&&!$('#overlay').hidden)closePanel()});
  $('#q').addEventListener('input',function(e){query=e.target.value;renderList()});
  $('#chips').addEventListener('click',function(e){var b=e.target.closest('[data-f]');if(!b)return;filter=b.getAttribute('data-f');renderChips();renderList()});
  $('#start').addEventListener('click',function(e){
    if(e.target.id==='chg')editStart();
    else if(e.target.id==='sdok')saveStart();
  });
  $('#list').addEventListener('change',function(e){var s=e.target.closest('[data-status-for]');if(s)changeStatus(s.getAttribute('data-status-for'),s.value)});
  $('#list').addEventListener('click',function(e){
    if(e.target.closest('select')||e.target.closest('a'))return;
    var n=e.target.closest('[data-act="new"]');if(n){openPanel(null);return}
    var r=e.target.closest('[data-id]');if(r)openPanel(r.getAttribute('data-id'));
  });

  /* Armazenamento: arquivo data.json ao lado do server.js */
  fillStatusSelect();render();
  fetch('/api/data').then(function(r){if(!r.ok)throw new Error();return r.json()}).then(function(d){
    apps=Array.isArray(d.apps)?d.apps:[];settings=d.settings||{};loaded=true;render();
  }).catch(function(){
    var n=$('#notice');n.className='notice';n.hidden=false;
    n.textContent='Não consegui ler os dados. Abra pelo endereço do servidor (http://localhost:3000) com o comando: node server.js';
    $('#new').disabled=true;loaded=true;render();
  });
})();
