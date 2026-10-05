/* ==========================================================================
   Shrine of Tung — casino client
   Source text for the casino IIFE that runs inside the about:blank shrine
   window and owns everything under #casino: the lobby, dice, limbo, roulette,
   plinko, blackjack, mines, beef, the shop and the shrine faucet.
   ========================================================================== */
(function () {
  "use strict";
  var Shrine = (window.Shrine = window.Shrine || {});

  /* ---------------------------------------------------------------------------
     Tung's Casino client. A standalone IIFE (runs after the chat IIFE) that owns
     everything inside #casino. It shares nothing with the chat code except the
     saved token in localStorage and the SHRINE_API base. All outcomes come from
     the Deno server (server.ts) — this file only sends bets/actions and paints
     whatever the server returns, so a player editing this code changes nothing.
     Written as a template literal (no backticks / no ${ } inside) since it is
     injected into the about:blank shrine window. */
  var CASINO_JS = `
(function(){
  var API=SHRINE_API, TKEY="shrine-token-v1";
  function tok(){try{return localStorage.getItem(TKEY)||"";}catch(e){return "";}}
  /* the maintenance switch is the page's to show, not the tables': the chat
     puts its one resting screen over everything and halts us with it */
  function resting(d){if(d&&d.maintenance===true){try{if(window.__shrineRest)window.__shrineRest(d);}catch(e){}}return d;}
  function jget(p){return fetch(API+p).then(function(r){return r.json().catch(function(){return{};});}).then(resting);}
  function jpost(p,b){b=b||{};b.token=tok();return fetch(API+p,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(b)}).then(function(r){if(refused(r)){refusedGate();return;}return r.json().catch(function(){return{};});}).then(resting);}
  function el(t,c,txt){var e=document.createElement(t);if(c)e.className=c;if(txt!=null)e.textContent=txt;return e;}
  /* ---- a hidden tab asks for nothing ----
     Every poll below runs on an interval, and the tables move fast enough that
     those intervals are short — a duel is read five times a second between two
     of them. None of that is worth a single request while nobody is looking at
     it, and a tab left open on the pit overnight was making all of them anyway.
     The intervals keep ticking; they simply do not reach the network. Coming
     back to the tab refreshes at once, so nothing is ever waited for. */
  function napping(){return !!document.hidden;}
  /* One slot, not a list: you are in the lobby, or in a duel, or at a round
     table, and whichever started last is the one worth catching up. A list
     would grow every time a view was re-entered and keep calling into views
     that are long gone. */
  var WAKE=null;
  function onWake(fn){WAKE=fn;}
  document.addEventListener("visibilitychange",function(){
    if(napping()||!WAKE)return;
    try{WAKE();}catch(e){}
  });

  /* ---- how fast the tables move ----
     The four animated games run unhurried by default, because watching the
     wheel slow down or the ball pick its way through the pegs is most of what
     you came for. Anyone who would rather not wait presses the lightning
     button, which is ONE setting shared by all of them and remembered between
     visits: it would be maddening to turn it on per game. Nothing about it
     touches the money — the server has already decided the outcome before a
     single frame is drawn, and pace() only picks how long the drawing takes. */
  var TKEY_TURBO="shrine-turbo-v1";
  var TURBO=false;
  try{TURBO=localStorage.getItem(TKEY_TURBO)==="1";}catch(e){}
  function pace(slow,fast){return TURBO?fast:slow;}
  function setTurbo(on){TURBO=!!on;try{localStorage.setItem(TKEY_TURBO,TURBO?"1":"0");}catch(e){}}
  /* the button itself, dropped into a game's heading. it is only a toggle; the
     views read pace() when they start an animation, so the next roll, spin or
     drop picks the new speed up on its own. */
  function boltBtn(){
    var b=el("button","boltbtn");
    b.type="button";
    var z=el("span",null,"\u26A1");
    var word=el("span",null,"");
    b.appendChild(z);b.appendChild(word);
    function paint(){
      b.classList.toggle("on",TURBO);
      word.textContent=TURBO?"fast":"slow";
      b.title=TURBO?"tables are running fast \u2014 press for the full animation":
        "tables are taking their time \u2014 press to speed them up";
      b.setAttribute("aria-pressed",TURBO?"true":"false");
    }
    b.onclick=function(){setTurbo(!TURBO);paint();};
    paint();
    return b;
  }
  function sv(t,a){var e=document.createElementNS("http://www.w3.org/2000/svg",t);for(var k in a)e.setAttribute(k,a[k]);return e;}

  /* ---- drawn game icons (the rest stay emoji) ---- */
  var SPADE_D="M12 2.2c-.3 0-.5.1-.7.3C9 4.9 3.6 9.6 3.6 13.6c0 2.2 1.8 3.9 3.9 3.9.8 0 1.6-.3 2.2-.7-.2 1.5-1 2.8-2.3 3.6-.3.2-.4.5-.3.8.1.3.4.5.7.5h8.4c.3 0 .6-.2.7-.5.1-.3 0-.6-.3-.8-1.3-.8-2.1-2.1-2.3-3.6.6.4 1.4.7 2.2.7 2.1 0 3.9-1.7 3.9-3.9 0-4-5.4-8.7-7.7-11.1-.2-.2-.4-.3-.7-.3z";
  // plinko: a ball dropping with speed lines trailing above it
  function icoPlinko(){
    var s=sv("svg",{viewBox:"0 0 24 24",width:"26",height:"26","aria-hidden":"true"});
    [["M8.5 3.2h7",".38"],["M6 7h12",".6"],["M8.8 10.8h6.4",".85"]].forEach(function(p){
      s.appendChild(sv("path",{d:p[0],stroke:"currentColor","stroke-width":"1.9","stroke-linecap":"round",fill:"none",opacity:p[1]}));
    });
    s.appendChild(sv("circle",{cx:"12",cy:"18",r:"4.2",fill:"currentColor"}));
    return s;
  }
  // blackjack: a playing card with the ace of spades centred on it
  function icoBlackjack(){
    var s=sv("svg",{viewBox:"0 0 24 24",width:"26",height:"26","aria-hidden":"true"});
    s.appendChild(sv("rect",{x:"5",y:"2.5",width:"14",height:"19",rx:"2.6",fill:"currentColor","fill-opacity":".15",stroke:"currentColor","stroke-width":"1.5"}));
    var g=sv("g",{transform:"translate(6.48,6.48) scale(0.46)"});
    g.appendChild(sv("path",{fill:"currentColor",d:SPADE_D}));
    s.appendChild(g);
    return s;
  }
  // the pit's own two: tung himself, and a single card on its back
  function icoPitTung(){
    var i=el("img","piticon");
    i.src=(typeof TUNG_IMG!=="undefined")?TUNG_IMG:"";i.alt="";
    i.onerror=function(){i.style.display="none";};
    return i;
  }
  function icoCut(){
    var s=sv("svg",{viewBox:"0 0 24 24",width:"26",height:"26","aria-hidden":"true"});
    s.appendChild(sv("rect",{x:"6",y:"2.5",width:"12",height:"19",rx:"2.6",fill:"currentColor","fill-opacity":".15",stroke:"currentColor","stroke-width":"1.5"}));
    s.appendChild(sv("path",{d:"M9.5 8.5h5M9.5 12h5M9.5 15.5h5",stroke:"currentColor","stroke-width":"1.5","stroke-linecap":"round",fill:"none",opacity:".7"}));
    return s;
  }
  // competitive gambling: a chip that is also a clock, because it is both
  function icoComp(){
    var s=sv("svg",{viewBox:"0 0 24 24",width:"26",height:"26","aria-hidden":"true"});
    s.appendChild(sv("circle",{cx:"12",cy:"12",r:"8.4",fill:"currentColor","fill-opacity":".15",stroke:"currentColor","stroke-width":"1.5"}));
    ["M12 3.6V6","M12 18V20.4","M3.6 12H6","M18 12H20.4"].forEach(function(d){
      s.appendChild(sv("path",{d:d,stroke:"currentColor","stroke-width":"1.7","stroke-linecap":"round",fill:"none"}));
    });
    s.appendChild(sv("path",{d:"M12 8.2V12l2.7 1.7",fill:"none",stroke:"currentColor","stroke-width":"1.7","stroke-linecap":"round","stroke-linejoin":"round"}));
    return s;
  }
  /* Two cards held at an angle, one overlapping the other.
     Every icon here is drawn in currentColor at a low fill-opacity, which is
     what made this one a mess: translucent means the back card's whole outline
     shows straight through the front one, so the overlap reads as a smear of
     crossing strokes rather than as a card in front of a card. Opacity cannot
     fix that and neither can a solid fill — there is no colour to fill it
     with, since the thing behind an icon is whatever the skin is painted.
     So the front card's silhouette, grown by its own stroke width, is cut out
     of the back card. What is left is the sliver that would actually be
     visible, and the two read as a pair of cards at any size. */
  var pkIcoN=0;
  function icoPoker(){
    var id="pkico"+(++pkIcoN);   /* both the lobby tile and the table header draw one */
    var s=sv("svg",{viewBox:"0 0 24 24",width:"26",height:"26","aria-hidden":"true"});
    var defs=sv("defs",{});
    var m=sv("mask",{id:id,maskUnits:"userSpaceOnUse",x:"0",y:"0",width:"24",height:"24"});
    m.appendChild(sv("rect",{x:"0",y:"0",width:"24",height:"24",fill:"#fff"}));
    m.appendChild(sv("rect",{x:"9.7",y:"4.5",width:"11.2",height:"14.8",rx:"2.9",fill:"#000",transform:"rotate(11 15.3 11.9)"}));
    defs.appendChild(m);
    s.appendChild(defs);
    s.appendChild(sv("rect",{x:"4.2",y:"5.6",width:"9",height:"12.6",rx:"1.8",fill:"currentColor","fill-opacity":".14",stroke:"currentColor","stroke-width":"1.5",transform:"rotate(-13 8.7 11.9)",mask:"url(#"+id+")"}));
    s.appendChild(sv("rect",{x:"10.8",y:"5.6",width:"9",height:"12.6",rx:"1.8",fill:"currentColor","fill-opacity":".22",stroke:"currentColor","stroke-width":"1.5",transform:"rotate(11 15.3 11.9)"}));
    s.appendChild(sv("path",{d:"M15.3 9.4c-.9.9-2.2 2-2.2 3.1a1.5 1.5 0 0 0 2.2 1.2 1.5 1.5 0 0 0 2.2-1.2c0-1.1-1.3-2.2-2.2-3.1z",fill:"currentColor"}));
    return s;
  }
  function icoChess(){
    /* a knight in profile: the one piece that reads as chess at 26 pixels */
    var s=sv("svg",{viewBox:"0 0 24 24",width:"26",height:"26","aria-hidden":"true"});
    s.appendChild(sv("path",{d:"M8.4 4.2c.2 1 .1 1.8-.4 2.5L6.2 9.1c-.5.7-.6 1.5-.2 2.2l.6 1 1.7-1.5.5-1.5 1.6-.8-.6 2.1-2.7 2.9c-.7.8-1.1 1.7-1.1 2.7v1.2h10.6v-2.4c0-3.6-1.3-6.6-3.9-8.9-.9-.8-1.7-1.6-2.2-2.6a3 3 0 0 0-2.1-.3z",
      fill:"currentColor","fill-opacity":".2",stroke:"currentColor","stroke-width":"1.25","stroke-linejoin":"round"}));
    s.appendChild(sv("rect",{x:"5",y:"18.4",width:"13.4",height:"2.3",rx:"1",fill:"currentColor","fill-opacity":".35",stroke:"currentColor","stroke-width":"1.1"}));
    s.appendChild(sv("circle",{cx:"9.1",cy:"8.1",r:".72",fill:"currentColor"}));
    return s;
  }
  function gameIcon(id){
    if(id==="plinko")return icoPlinko();
    if(id==="blackjack")return icoBlackjack();
    if(id==="pit-tung")return icoPitTung();
    if(id==="pit-cut")return icoCut();
    if(id==="pit-comp")return icoComp();
    if(id==="pit-poker")return icoPoker();
    if(id==="pit-chess")return icoChess();
    return el("span",null,{roulette:"◉",mines:"💣",beef:"🐄",limbo:"📈",dice:"🎲"}[id]||"");
  }
  function money(n){return (Math.round(Number(n)*100)/100).toFixed(2);}
  function mult(n){return (Math.round(Number(n)*100)/100).toFixed(2)+"x";}

  var screen=document.getElementById("casscreen");
  var balEl=document.getElementById("casbal");
  var casEl=document.getElementById("casino");
  var BAL=0, claimTimer=null;
  function setBal(b){if(typeof b==="number"&&!isNaN(b)){BAL=b;balEl.textContent=money(b);paintBars();}}

  /* Out of sahurs? point them at the shrine. Inside a game that prompt shows
     every time they are dry, since it is the answer to "why can't I bet". In
     the lobby it is a one-time nudge for a new player, remembered per browser. */
  var VIEW="lobby", brokeEl=null, BROKE_KEY="shrine-broke-hint";
  function hideBroke(){if(brokeEl&&brokeEl.parentNode)brokeEl.parentNode.removeChild(brokeEl);}
  function buildBroke(){
    var e=el("div","brokebar");
    var t=el("div","grow");
    t.appendChild(el("h4",null,"you are out of sahurs"));
    t.appendChild(el("p",null,"tung tung god provides, and asks nothing back. claim your free sahurs at the shrine."));
    e.appendChild(t);
    var go=el("button","cbtn go","go to the shrine");
    go.onclick=function(){if(window.__casinoShrine)window.__casinoShrine();};
    e.appendChild(go);
    var x=el("button","brokex","\u2715");x.title="dismiss";
    x.onclick=hideBroke;
    e.appendChild(x);
    return e;
  }
  function paintBroke(){
    var w=screen.querySelector(".caswrap");
    if(!w||VIEW==="shrine"){hideBroke();return;}      // no point nagging at the shrine itself
    if(ROUND.live){hideBroke();return;}               // nor mid-round: they have wood to spend and their sahurs are in the pot
    if(BAL>0.0001){hideBroke();return;}
    if(VIEW==="lobby"){
      var seen=false;try{seen=localStorage.getItem(BROKE_KEY)==="1";}catch(e){}
      if(seen){hideBroke();return;}
      try{localStorage.setItem(BROKE_KEY,"1");}catch(e){}
    }
    if(!brokeEl)brokeEl=buildBroke();
    if(brokeEl.parentNode!==w)w.insertBefore(brokeEl,w.firstChild);
  }
  /* leaving a table stops holding its wager: from here on the server's own
     number is the honest one, whatever the table was in the middle of showing */
  function clearTimer(){if(claimTimer){clearInterval(claimTimer);claimTimer=null;}ROUND.hold=false;pitStop();}
  /* the two strips that ride above whatever screen is open */
  function paintBars(){paintBroke();paintRound();}

  /* ---- where "back" goes ----
     A round of Competitive Gambling is played out ON THE FLOOR: you leave the
     table's own page, pick a house game, and the round follows you onto it.
     Which means that for those three minutes the table's page IS the lobby —
     it carries the whole floor menu, both stacks and the table talk — and
     walking out of a game landed you on the casino floor instead. One level
     further out than you came from, with the round you are in the middle of
     reduced to a bar along the top, and the way back to it a different button
     in a different place.

     So while a round is running, that is where the back button goes, and it
     says so. The pit's own pages set this again for themselves straight after
     mount(): standing ON the round's page, the way out really is the floor.

     _out is how a button remembers it was given a destination of its own, so
     that a round starting or ending under it only ever relabels the ones that
     did not. */
  function roundTable(){
    if(!ROUND.live)return false;
    var v=ROUND.live;
    clearTimer();
    pitEnter(v);
    return true;
  }
  function paintBack(btn,out){
    if(!btn)return;
    btn._out=out||null;
    if(out){btn.textContent="\u2190 back to lobby";btn.onclick=out;return;}
    if(ROUND.live){
      btn.textContent="\u2190 back to the round";
      /* the round can end between the paint and the press */
      btn.onclick=function(){if(!roundTable())window.__casinoOpen();};
      return;
    }
    btn.textContent="\u2190 back to lobby";
    btn.onclick=function(){window.__casinoOpen();};
  }
  /* a round starting or ending has to move the button under whoever is looking
     at it, or it keeps offering a way back to a table that is over */
  function refreshBack(){
    var b=screen.querySelector(".casback");
    if(b&&!b._out)paintBack(b,null);
  }

  /* ---- a round of Competitive Gambling, from anywhere in the casino ----
     A round is the one thing in here that is not a screen. The player is not
     sat at the pit's table for those three minutes, they are out on the floor
     spending wood, and the floor is every other page in the casino. So the
     round gets a bar of its own that rides above whatever they have open —
     both stacks and the clock — and a poll that outlives every navigation,
     because the three minutes do not care which table they are standing at.
     The wood itself is the server's: this only paints what it is told. */
  var ROUND={live:null,poll:null,tick:null,bar:null,done:null,mine:0,hold:false,sides:0};
  function hideRound(){if(ROUND.bar&&ROUND.bar.parentNode)ROUND.bar.parentNode.removeChild(ROUND.bar);}
  function roundStop(){
    if(ROUND.poll){clearInterval(ROUND.poll);ROUND.poll=null;}
    if(ROUND.tick){clearInterval(ROUND.tick);ROUND.tick=null;}
    ROUND.live=null;ROUND.hold=false;hideRound();
    /* including the way back to it, wherever they are standing */
    refreshBack();
    /* the server has already deleted it; nothing of it stays on this screen */
    talkReset();
  }
  /* One slot per chair, because a round can seat two, three or four and the
     bar has to carry the whole table — the stacks are the score and a player
     out on the floor cannot see the table's own page. */
  function buildRound(n){
    var e=el("div","roundbar");
    e.appendChild(el("span","rtag","round"));
    e._sides=[];
    for(var i=0;i<n;i++){
      /* at two the unit sits between the pair, exactly as it does on the big
         scoreboard, so the bar and the table's page read as the same thing.
         at three and four it goes on the end instead of repeating. */
      if(i)e.appendChild(el("span","rvs",n===2?"wood":"vs"));
      var side=el("div","rside");
      side._n=el("b",null,"\u2026");side.appendChild(side._n);
      side._v=el("span","rv","-");side.appendChild(side._v);
      e.appendChild(side);
      e._sides.push(side);
    }
    if(n!==2)e.appendChild(el("span","rvs","wood"));
    e._clock=el("span","rclock","");e.appendChild(e._clock);
    /* the round is spent out on the floor, not at the table, so the talk has to
       be reachable from wherever they are standing: a drawer under the bar. */
    var talk=el("button","cbtn sec","\uD83D\uDCAC");talk.type="button";talk.title="table talk";
    var drawer=el("div","talkdrawer");drawer.style.display="none";
    talk.onclick=function(){
      TALK.open=!TALK.open;
      drawer.style.display=TALK.open?"block":"none";
      if(TALK.open){
        drawer.innerHTML="";drawer.appendChild(talkBox());
        if(TALK.input)TALK.input.focus();
      }else{TALK.log=null;TALK.input=null;}
      talkPaint();
    };
    e.appendChild(talk);
    var go=el("button","cbtn sec","the table");
    go.onclick=function(){roundTable();};
    e.appendChild(go);
    e.appendChild(drawer);
    e._talkBtn=talk;e._drawer=drawer;
    return e;
  }
  function paintRound(){
    refreshBack();
    if(!ROUND.live){hideRound();return;}
    var w=screen.querySelector(".caswrap");
    /* the table's own page says all of this bigger, so the bar stands down there */
    if(!w||VIEW==="pit"){hideRound();return;}
    /* the table cannot gain or lose a chair mid-round, but a bar built for the
       last round must not be reused for a round of a different size */
    var n=compSeats(ROUND.live).length;
    if(!ROUND.bar||ROUND.sides!==n){hideRound();ROUND.bar=buildRound(n);ROUND.sides=n;}
    if(ROUND.bar.parentNode!==w)w.insertBefore(ROUND.bar,w.firstChild);
    paintRoundClock();
  }
  function paintRoundClock(){
    var d=ROUND.live,b=ROUND.bar;
    if(!d||!b||!b.isConnected)return;
    var seats=compSeats(d);
    /* our own stack is the held one while a table is still showing a wager;
       reading the poll's number there would give the wheel away mid-spin */
    var at=seats.map(function(p){return p.you?ROUND.mine:chipsOf(p);});
    var best=-Infinity,worst=Infinity;
    at.forEach(function(c){if(c>best)best=c;if(c<worst)worst=c;});
    b._sides.forEach(function(side,i){
      var p=seats[i];
      if(!p){side._n.textContent="\u2026";side._v.textContent="-";side.className="rside";return;}
      side._n.textContent=p.you?"you":(p.name||"them");
      side._v.textContent=money(at[i]);
      /* level all round is nobody ahead, so nothing is lit either way */
      side.className="rside"+(best===worst?"":(at[i]===best?" up":(at[i]===worst?" down":"")));
    });
    var ms=pitLeft(d.deadline);
    b._clock.textContent=pitClockText(ms);
    b._clock.className="rclock"+(ms<=15000?" hot":"");
  }
  /* ---- TABLE TALK: the little chat inside a round ----
     Not the shrine's chat and nothing like it. It exists for the three minutes
     of a round and the server deletes it in the same commit that ends one, so
     there is no history here either: TALK.lines is whatever the last poll said,
     and when the round stops it is dropped on the floor with the rest.

     It rides the poll that is already running, so nothing new is fetched. The
     draft survives a repaint because the box is rebuilt constantly underneath
     the person typing in it. */
  /* TALK.at is which table is being talked at: {id, you}. It used to be read off
     ROUND.live, which only exists for a round of Competitive Gambling — poker
     has the same box and no round behind it, so the box is told which table it
     belongs to instead of guessing. TALK.n is how many lines the server says have
     been said, which is what the poll hands back so it knows whether to fetch
     the conversation at all. */
  var TALK={at:null,n:-1,lines:[],draft:"",open:false,log:null,input:null,seen:0,unread:0};
  function talkReset(){TALK.at=null;TALK.n=-1;TALK.lines=[];TALK.draft="";TALK.open=false;TALK.log=null;TALK.input=null;TALK.seen=0;TALK.unread=0;}
  /* Which table the box is for. A different one is a different conversation,
     so everything about the last one goes — including the count, or the server
     would think this client was already up to date with a table it has never
     seen and never send it the lines. */
  function talkFor(id,you){
    if(!id){if(TALK.at)talkReset();return;}
    if(!TALK.at||TALK.at.id!==id){talkReset();TALK.at={id:id,you:you||null};return;}
    TALK.at.you=you||TALK.at.you;
  }
  /* The poll's answer, whichever page it came back to. A null line list means the
     server did not even read the conversation because this client already has
     it — which is not the same as [], "there is nothing", and must not empty
     the box. */
  function talkSync(lines,said){
    if(typeof said==="number")TALK.n=said;
    if(lines===null||lines===undefined){talkPaint();return;}
    if(!lines.length){if(TALK.lines.length)TALK.lines=[];}
    else TALK.lines=lines;
    var n=TALK.lines.length;
    TALK.unread=Math.max(0,n-TALK.seen);
    if(TALK.open||!TALK.log)TALK.seen=n;
    talkPaint();
  }
  function talkPaint(){
    if(TALK.log&&TALK.log.isConnected){
      /* only redraw when the line count moved: the log is rebuilt on every
         poll otherwise, which eats a selection and fights the scroll */
      if(TALK.log._n!==TALK.lines.length){
        TALK.log._n=TALK.lines.length;
        TALK.log.innerHTML="";
        TALK.lines.forEach(function(m){
          var row=el("div","tkline");
          var me=TALK.at&&TALK.at.you;
          row.appendChild(el("b",null,(me&&m.name===me)?"you":String(m.name||"")));
          row.appendChild(el("span",null,m.text));
          TALK.log.appendChild(row);
        });
        TALK.log.scrollTop=TALK.log.scrollHeight;
        TALK.seen=TALK.lines.length;TALK.unread=0;
      }
    }
    /* the same badge, on whichever of the two buttons is on screen: the round
       bar's out on the floor, the poker table's in its own header */
    if(ROUND.bar&&ROUND.bar._talkBtn){
      ROUND.bar._talkBtn.textContent=TALK.unread?("\uD83D\uDCAC "+TALK.unread):"\uD83D\uDCAC";
      ROUND.bar._talkBtn.className="cbtn sec"+(TALK.unread?" hot":"");
    }
    if(PIT.pkTalkBtn&&PIT.pkTalkBtn.isConnected){
      var badge=PIT.pkTalkBtn.querySelector(".pkbadge");
      if(badge){
        badge.textContent=TALK.unread?String(TALK.unread):"";
        badge.style.display=TALK.unread?"block":"none";
      }
      PIT.pkTalkBtn.className="pktalkbtn"+(TALK.unread?" hot":"")+(TALK.open?" on":"");
    }
  }
  /* one builder, two homes: the table's own page and a drawer under the round
     bar. They are never on screen at once — the bar stands down on the pit. */
  function talkBox(){
    var box=el("div","talkbox");
    var log=el("div","tklog");log._n=-1;
    var form=document.createElement("form");form.className="tkform";
    var inp=document.createElement("input");
    inp.className="tkin";inp.maxLength=200;inp.autocomplete="off";
    inp.placeholder="say something at the table";
    inp.value=TALK.draft;
    inp.addEventListener("input",function(){TALK.draft=inp.value;});
    var send=el("button","cbtn sec","say");send.type="submit";
    form.appendChild(inp);form.appendChild(send);
    form.addEventListener("submit",function(ev){
      ev.preventDefault();
      var text=inp.value.trim();
      var at=TALK.at;
      if(!text||!at)return;
      inp.value="";TALK.draft="";
      send.disabled=true;
      jpost("/duel/say",{id:at.id,text:text}).then(function(d){if(refused(d)){refusedGate();return;}
        send.disabled=false;
        /* the answer carries the conversation with our own line already on the
           end of it, so the count moves with it — otherwise the next poll would
           fetch a list we are holding */
        if(d&&d.talk)talkSync(d.talk,TALK.n+1);
        else if(d&&d.error)bad(null,0);
      }).catch(function(){send.disabled=false;});
    });
    box.appendChild(log);box.appendChild(form);
    TALK.log=log;TALK.input=inp;TALK.log._n=-1;
    talkPaint();
    return box;
  }

  /* One duel view in, and everything that cares about a round picks it up: the
     bar, the poll, and the moment it stops being live. */
  function roundSync(v){
    if(v&&v.game==="comp"&&v.state==="live"){
      var fresh=!ROUND.live;
      ROUND.live=v;
      /* the box asks TALK.at which table it is for, rather than reading it off
         a round that poker does not have */
      talkFor(v.id,v.you);
      /* while a table is still playing a wager out, the number it is going to
         land on is not ours to paint yet — see roundBet below */
      if(fresh||!ROUND.hold)ROUND.mine=v.yourChips;
      if(!ROUND.poll){ROUND.poll=setInterval(roundPoll,1400);onWake(roundPoll);}
      if(!ROUND.tick)ROUND.tick=setInterval(paintRoundClock,250);
      paintRound();
      return;
    }
    if(!ROUND.live)return;
    /* the buzzer. take them to the result wherever in the casino they are
       standing — and if they are not in the casino at all, hold it for when
       they next open it, because the pot has already moved without them. */
    var over=(v&&v.id===ROUND.live.id)?v:null;
    roundStop();
    if(!over)return;
    /* topShow() sets this display outright, so it is the honest answer to "is
       the casino the thing on screen" — and an empty one means this window has
       never opened the casino at all, which counts as not looking. */
    var watching=casEl&&casEl.style.display&&casEl.style.display!=="none";
    if(watching){clearTimer();pitEnter(over);}
    else ROUND.done=over;
  }
  function roundPoll(){
    if(!ROUND.live){roundStop();return;}
    if(napping())return;
    /* the pit's own page is already polling this duel; two would only race */
    if(VIEW==="pit")return;
    jget("/duel/state?token="+encodeURIComponent(tok())+"&id="+encodeURIComponent(ROUND.live.id)+"&talk="+TALK.n).then(function(d){
      if(refused(d)){roundStop();refusedGate();return;}
      if(!d||d.error){if(d&&d.error==="gone")roundStop();return;}
      pitSkew(d);setBal(d.balance);talkSync(d.talk,d.talkN);roundSync(d.duel);
    }).catch(function(){});
  }
  /* Every wager on the floor names the round it believes it is in. The server
     decides which purse it comes out of either way — this can only ever stop a
     bet, never aim one — so a roll meant as wood cannot land on real sahurs
     because the buzzer went while they were reaching for the button. */
  function wager(body){if(ROUND.live)body.round=ROUND.live.id;return body;}

  /* ---- a wager is not over until the table has finished showing it ----
     The server answers a bet with the stack it landed on, and it answers the
     instant the bet is decided — which on every table here is well before the
     player has seen it happen. Painting that number as it arrives would give
     the wheel away while it was still spinning, the cow away mid-lane and the
     dealer's hole card away before he turned it. So the stack is held from the
     moment a stake leaves it until the table says it has finished: roundBet()
     takes the stake off the pile, roundSaw() lands whatever came back. The poll
     keeps its hands off in between, since all it knows is the answer. */
  function roundBet(amount){
    if(!ROUND.live)return;
    ROUND.hold=true;
    var n=Number(amount);
    if(isFinite(n)&&n>0)ROUND.mine=Math.max(0,Math.round((ROUND.mine-n)*100)/100);
    paintRoundClock();pitPaintClock();
  }
  /* a stake is out and the table is holding it — a board dealt, a hand in
     motion. The stack is the server's number now, but it is still held: what
     that stake is worth has not been decided yet. */
  function roundStaked(d){
    if(!ROUND.live||!d||typeof d.wood!=="number")return;
    ROUND.mine=d.wood;paintRoundClock();pitPaintClock();
  }
  function roundSaw(d){
    if(!ROUND.live)return;
    ROUND.hold=false;
    ROUND.mine=(d&&typeof d.wood==="number")?d.wood:ROUND.live.yourChips;
    paintRoundClock();pitPaintClock();
    if(d&&d.roundOver)roundPoll();
  }

  /* the win celebration: a box that pops over the whole casino showing what you
     just took, then fades. shared by every game. */
  var winpop=null;
  /* The toast has to go inert once it has played. Leaving the casino sets
     #casino to display:none, and returning flips it back to display:flex —
     which RESTARTS any css animation still attached, replaying the previous
     game's win out of nowhere. So .show is stripped the moment the keyframes
     finish, and again whenever the casino is entered or left. */
  function hideWin(){ if(winpop) winpop.classList.remove("show"); }
  /* the note is an extra line under the figure, for when the number that landed
     is not the whole story — a faucet claim the bank has taken its half out of
     being the only one so far. */
  function celebrate(payout,m,note){
    if(!(Number(payout)>0))return;
    if(!winpop){
      winpop=el("div");winpop.id="winpop";
      winpop._a=el("span","wamt","");winpop._m=el("span","wmul","");winpop._n=el("span","wnote","");
      winpop.appendChild(winpop._a);winpop.appendChild(winpop._m);winpop.appendChild(winpop._n);
      winpop.addEventListener("animationend",hideWin);
      casEl.appendChild(winpop);
    }
    winpop._a.textContent="+"+money(payout)+(ROUND.live?" wood":" sahurs");
    winpop._m.textContent=mult(m);
    winpop._n.textContent=note||"";
    winpop._n.style.display=note?"":"none";
    winpop.classList.remove("show");
    void winpop.offsetWidth;            /* restart the keyframes */
    winpop.classList.add("show");
  }

  window.__casinoBack=function(){clearTimer();hideWin();};
  /* the page's lockout: a timeout or a ban stops every table poll at once,
     the round's included, which otherwise follows you around the floor */
  window.__casinoHalt=function(){clearTimer();hideWin();roundStop();};
  window.__casinoShop=function(){clearTimer();hideWin();viewShop();};
  window.__casinoShrine=function(){clearTimer();hideWin();viewShrine();};
  window.__casinoBank=function(){clearTimer();hideWin();viewBank();};

  window.__casinoOpen=function(){
    clearTimer();hideWin();
    if(DEAD_KEY&&!tok()){deadKeyGate();return;}
    var lw=column();
    var l=el("div","casgate");l.appendChild(el("p",null,"loading the tables..."));lw.appendChild(l);
    jget("/cas/me?token="+encodeURIComponent(tok())).then(function(d){
      if(refused(d)){refusedGate();return;}
      if(!d||d.error){showGate();return;}
      setBal(d.balance);
      /* a round runs whether or not this window is looking at it, so the first
         thing the casino asks on the way in is whether one is still going —
         and whether one finished while they were somewhere else */
      roundSync(d.round||null);
      if(ROUND.done){var fin=ROUND.done;ROUND.done=null;pitEnter(fin);return;}
      renderLobby(d);
    }).catch(netGate);
  };

  /* Every gate screen is the same shape: a heading and some lines, painted over
     whatever was on the table. Going through here means no screen can be left
     showing a half-finished "loading..." when a request comes back refused. */
  function gate(title,lines){
    clearTimer();
    var gw=column();
    var g=el("div","casgate");
    g.appendChild(el("h3",null,title));
    for(var i=0;i<lines.length;i++)g.appendChild(el("p",null,lines[i]));
    gw.appendChild(g);
  }

  function showGate(){
    gate("members only",[
      "Tung's Casino is for approved members of the Shrine of Tung. You need chat access to play.",
      "Head back and open the Shrine of Tung to apply. Once tung approves you, your sahurs live under that same username."
    ]);
  }

  /* Set once we have dropped a key the server disowned. Without it the next
     screen would fall back to the generic "members only" gate, because by then
     there is genuinely no key left to explain — and the reason they are looking
     at a gate would quietly change out from under them. */
  var DEAD_KEY=false;
  function clearTok(){DEAD_KEY=true;try{localStorage.removeItem(TKEY);}catch(e){}}

  function deadKeyGate(){
    gate("this key is no longer valid",[
      "the account it belonged to is gone. tung may have removed it, or it was never his to begin with.",
      "head back and open the Shrine of Tung to apply again. you will be given a new key."
    ]);
  }

  /* did the server refuse our key? casUser() collapses deleted, unapproved and
     banned all into one "unauthorized", so this only tells us it said no. */
  function refused(d){return !!(d&&d.error==="unauthorized");}

  /* The key was refused. /cas/me cannot say why, so ask /status — the same
     endpoint the chat believes — and name the actual reason. A key the server
     has disowned is dropped here rather than retried forever, which is what the
     chat does too; a key that is merely blocked or pending is kept. */
  function refusedGate(){
    var t=tok();
    if(!t){if(DEAD_KEY){deadKeyGate();}else{showGate();}return;}
    gate("checking your key\u2026",["one moment."]);
    jget("/status?token="+encodeURIComponent(t)).then(function(s){
      var st=s&&s.status;
      if(st==="approved"){
        if(s.blocked){
          /* a timeout or a ban is the whole shrine's, not the tables': the
             page puts its one screen over everything */
          if(window.__shrineLock){window.__shrineLock(s);return;}
          gate("you are blocked",[
            s.reason==="banned"
              ? "tung has barred you from the shrine. the tables are shut to you."
              : "you are timed out. the tables reopen when it lifts.",
            "nothing you had is gone. it waits."
          ]);
        }else{
          showGate();
        }
        return;
      }
      if(st==="pending"){
        gate("still pending",[
          "tung has not finished reading your application.",
          "the tables open the moment he approves you."
        ]);
        return;
      }
      /* "none" (deleted, or never existed) and "rejected": this key is spent */
      clearTok();setBal(0);deadKeyGate();
    }).catch(function(){
      gate("the shrine did not answer",[
        "could not reach the shrine to check your key.",
        "check your connection and try again."
      ]);
    });
  }

  /* a request died in transit — never clear a key over a network blip */
  function netGate(){
    gate("the shrine did not answer",[
      "the tables could not be reached.",
      "check your connection and try again."
    ]);
  }

  /* ---------- the Shrine of Tung Tung God (the faucet), its own page ---------- */
  function viewShrine(){
    var v=mount("Shrine of Tung Tung God","⛲");VIEW="shrine";hideBroke();
    var altar=el("div","altar");
    var img=el("img","godimg");
    img.src=(typeof TUNGGOD_IMG!=="undefined")?TUNGGOD_IMG:"";
    img.alt="Tung Tung God";
    img.onerror=function(){img.style.display="none";};
    altar.appendChild(img);
    altar.appendChild(el("p","godsub","offer nothing. receive sahurs. such is his way."));
    var claim=el("button","cbtn go");claim.id="casclaim";
    altar.appendChild(claim);
    var sub=el("p","godnote","");altar.appendChild(sub);
    v.appendChild(altar);
    var r=res(v);

    var me={canClaim:false,nextClaim:0,faucetAmount:10,interval:7200000,banUntil:0,reduced:null,slowed:null};
    /* the whole-hours way of saying an interval: "2 hours", "3.5 hours" */
    function hrs(ms){var h=Math.round(ms/360000)/10;return h+(h===1?" hour":" hours");}
    /* what tung's displeasure costs, said under the button so nobody has to
       wonder why the number went down or the wait went up */
    function penaltyNote(){
      var bits=[];
      if(me.reduced)bits.push("your claims pay "+me.reduced.pct+"% until "+new Date(me.reduced.until).toLocaleString());
      if(me.slowed)bits.push("you wait "+hrs(me.interval)+" between claims until "+new Date(me.slowed.until).toLocaleString());
      return bits.length?" tung is displeased: "+bits.join(", and ")+".":"";
    }
    function paintClaim(){
      var now=Date.now();
      if(me.banUntil>now){
        claim.disabled=true;claim.textContent="the altar is closed to you";
        sub.textContent="tung has barred your hands from his altar until "+new Date(me.banUntil).toLocaleString()+".";
        return;
      }
      if(me.canClaim||!me.nextClaim||now>=me.nextClaim){
        claim.disabled=false;claim.textContent="claim "+(me.faucetAmount||10)+" sahurs";
        sub.textContent=(me.slowed?"free sahurs, on the house. every "+hrs(me.interval)+".":"free sahurs, on the house. every 2 hours.")+penaltyNote();clearTimer();
      }else{
        claim.disabled=true;
        var s=Math.max(0,Math.floor((me.nextClaim-now)/1000));
        var h=Math.floor(s/3600),m=Math.floor((s%3600)/60),ss=s%60;
        claim.textContent="next claim in "+h+"h "+(m<10?"0":"")+m+"m "+(ss<10?"0":"")+ss+"s";
        sub.textContent=(me.slowed?"tung already blessed you. he does not pour twice in "+hrs(me.interval)+". sit.":"tung already blessed you. he does not pour twice in two hours. sit.")+penaltyNote();
      }
    }
    claim.disabled=true;claim.textContent="consulting the shrine...";
    jget("/cas/me?token="+encodeURIComponent(tok())).then(function(d){
      /* these two paint a whole new screen, which is the point: leaving the
         claim button sitting on "consulting the shrine..." is how this page
         used to hang forever on a key the server had already refused. */
      if(refused(d)){refusedGate();return;}
      if(!d||d.error){showGate();return;}
      setBal(d.balance);
      me.canClaim=d.canClaim;me.nextClaim=d.nextClaim;me.faucetAmount=d.faucetAmount||10;
      me.interval=d.faucetInterval||7200000;me.banUntil=d.claimBan||0;
      me.reduced=d.reduced||null;me.slowed=d.slowed||null;
      paintClaim();clearTimer();claimTimer=setInterval(paintClaim,1000);
    }).catch(netGate);

    claim.onclick=function(ev){
      claim.disabled=true;
      /* how the click was made rides along for the sahur watch */
      var cli=window.__claimProof?window.__claimProof(ev):undefined;
      jpost("/cas/claim",{cli:cli}).then(function(d){if(refused(d)){refusedGate();return;}
        if(d&&d.error==="claim_banned"){me.banUntil=d.until||0;paintClaim();return;}
        if(d&&d.ok){
          setBal(d.balance);me.canClaim=false;me.nextClaim=d.nextClaim;
          /* the bank helps itself to half on the way past while a debt stands,
             so the toast says what landed AND what did not */
          if(d.garnished>0){
            celebrate(d.claimed,1,"the bank took "+money(d.garnished));
            ok(r,d.cleared
              ?"tung tung god provides. the bank took its half \u2014 and that clears you."
              :"tung tung god provides. the bank took its half. "+money(d.owed)+" still owed.");
          }else{
            celebrate(d.claimed,1);ok(r,"tung tung god provides.");
          }
        }else if(d&&d.nextClaim){me.canClaim=false;me.nextClaim=d.nextClaim;}
        paintClaim();
      }).catch(paintClaim);
    };
  }

  /* ---------- THE BANK OF TUNG ----------
     Laid out like the shrine's altar next door, because it is the same kind of
     place: one character, one thing he does, one button. The difference is that
     the shrine gives and the bank lends, and the lending has a price on it.

     Every number on this screen is the server's. The client works out nothing
     about interest, caps or what is owed — it asks /bank and paints the answer,
     the same way the pit paints a duel. */
  function viewBank(){
    var v=mount("Bank of Tung","\uD83C\uDFE6");VIEW="bank";hideBroke();
    var altar=el("div","altar");
    var img=el("img","godimg lender");
    /* which face is behind the counter today. the odds and both pictures are
       in config.js — see BANK_IMG / BANK_RARE_IMG / BANK_RARE_CHANCE. */
    var rare=(typeof BANK_RARE_CHANCE!=="undefined"?BANK_RARE_CHANCE:0);
    var pick=(Math.random()<rare&&typeof BANK_RARE_IMG!=="undefined")
      ? BANK_RARE_IMG
      : (typeof BANK_IMG!=="undefined"?BANK_IMG:"");
    img.src=pick;
    img.alt="the lender";
    img.onerror=function(){img.style.display="none";};
    altar.appendChild(img);
    var sub=el("p","godsub","");altar.appendChild(sub);
    var stat=el("div","bankstat");altar.appendChild(stat);
    var ctlwrap=el("div","bankctl");altar.appendChild(ctlwrap);
    var note=el("p","godnote","");altar.appendChild(note);
    v.appendChild(altar);
    var r=res(v);

    function paint(d){
      stat.innerHTML="";ctlwrap.innerHTML="";
      if(!d){sub.textContent="the bank is shut.";return;}
      var owed=Number(d.owed)||0, cap=Number(d.cap)||0;
      /* the standing cap, and a one-off tung may have put on top of it for this
         loan only. the server works both out; all we do is say which is which,
         so nobody mistakes a favour for a new ceiling. */
      var boost=Number(d.boost)||0;
      var limit=Number(d.limit);if(!(limit>=0))limit=cap+boost;
      /* what he would actually hand over right now. In debt this is normally
         nothing, and is only ever more than nothing because a one-off is
         sitting on the account. */
      var canBorrow=Number(d.canBorrow)||0;
      var pct=Math.round((Number(d.interest)||0)*100);
      var half=Math.round((Number(d.garnish)||0.5)*100);
      /* the counter: what you owe, and what he will lend */
      function cell(label,val,hot){
        var c=el("div","bcell"+(hot?" hot":""));
        c.appendChild(el("b",null,label));
        c.appendChild(el("span",null,val));
        return c;
      }
      stat.appendChild(cell("owed",money(owed)+" sahurs",owed>0));
      stat.appendChild(cell("your cap",money(cap)+" sahurs"));
      if(boost>0)stat.appendChild(cell("this once","+"+money(boost)+" sahurs",true));
      stat.appendChild(cell("his cut",pct+"% on top"));

      if(owed>0){
        sub.textContent="he is waiting on "+money(owed)+" sahurs.";
        note.textContent="pay him back whenever you like \u2014 or do not, and he takes "+half+
          "% of every shrine claim until it is square.";
        var amt=betField(money(owed));amt.className="tin";
        var pay=el("button","cbtn go","pay back");
        var all=el("button","cbtn sec","pay it all");
        ctlwrap.appendChild(ctl("amount",amt));
        var bw=el("div","casrow");bw.appendChild(pay);bw.appendChild(all);
        ctlwrap.appendChild(ctl(" ",bw));
        function repay(body,btn){
          btn.disabled=true;r.className="casres";r.textContent="";
          jpost("/bank/repay",body).then(function(d2){if(refused(d2)){refusedGate();return;}
            btn.disabled=false;
            if(!d2||d2.error){bad(r,d2&&d2.error==="insufficient"?"you do not have it.":((d2&&d2.error)||"he did not take it."));load();return;}
            setBal(d2.balance);
            if(d2.cleared)ok(r,"square. he has nothing on you.");
            else ok(r,"paid "+money(d2.paid)+". "+money(d2.owed)+" to go.");
            load();
          }).catch(function(){btn.disabled=false;bad(r,"network error");});
        }
        pay.onclick=function(){repay({amount:Number(amt.value)},pay);};
        all.onclick=function(){repay({},all);};
        /* The bank wants the last one settled before it lends again, and a
           one-off is what suspends that. It is aimed at precisely the person
           who is already in the red, so when there is room left under the
           stretched ceiling the borrow control belongs here too, rather than
           behind a debt they have just been told to clear first. */
        if(canBorrow>0){
          note.textContent="tung has stretched your "+money(cap)+" to "+money(limit)+
            " for one more loan, so you may take "+money(canBorrow)+" more without settling up first. "+
            "he still takes "+half+"% of every shrine claim until the lot is square.";
          var more=betField(money(canBorrow));more.className="tin";
          var take2=el("button","cbtn go","borrow anyway");
          ctlwrap.appendChild(ctl("borrow",more));
          var bw3=el("div","casrow");bw3.appendChild(take2);
          ctlwrap.appendChild(ctl(" ",bw3));
          take2.onclick=function(){
            take2.disabled=true;r.className="casres";r.textContent="";
            jpost("/bank/borrow",{amount:Number(more.value)}).then(function(d2){if(refused(d2)){refusedGate();return;}
              take2.disabled=false;
              if(!d2||d2.error){bad(r,(d2&&d2.error)||"he said no.");load();return;}
              setBal(d2.balance);celebrate(d2.borrowed,1,"you owe "+money(d2.owed));
              ok(r,"borrowed "+money(d2.borrowed)+". you owe him "+money(d2.owed)+" in total.");
              load();
            }).catch(function(){take2.disabled=false;bad(r,"network error");});
          };
        }
      }else if(limit>0){
        sub.textContent="he lends up to "+money(limit)+" sahurs. he wants "+pct+"% on top.";
        note.textContent=boost>0
          ? ("tung has stretched your "+money(cap)+" to "+money(limit)+" for this loan and this loan only. "+
             "pay him back whenever you like \u2014 or do not, and he takes "+half+
             "% of every shrine claim until it is square.")
          : ("pay him back whenever you like \u2014 or do not, and he takes "+half+
             "% of every shrine claim until it is square.");
        var want=betField(money(limit));want.className="tin";
        var take=el("button","cbtn go","borrow");
        ctlwrap.appendChild(ctl("amount",want));
        var bw2=el("div","casrow");bw2.appendChild(take);
        ctlwrap.appendChild(ctl(" ",bw2));
        take.onclick=function(){
          take.disabled=true;r.className="casres";r.textContent="";
          jpost("/bank/borrow",{amount:Number(want.value)}).then(function(d2){if(refused(d2)){refusedGate();return;}
            take.disabled=false;
            if(!d2||d2.error){bad(r,(d2&&d2.error)||"he said no.");load();return;}
            setBal(d2.balance);celebrate(d2.borrowed,1,"you owe "+money(d2.owed));
            ok(r,"borrowed "+money(d2.borrowed)+". you owe him "+money(d2.owed)+".");
            load();
          }).catch(function(){take.disabled=false;bad(r,"network error");});
        };
      }else{
        sub.textContent="the bank is shut to you.";
        note.textContent="tung has set your cap to nothing. take it up with him.";
      }
    }
    function load(){
      jget("/bank?token="+encodeURIComponent(tok())).then(function(d){
        if(refused(d)){refusedGate();return;}
        if(!d||d.error){showGate();return;}
        setBal(d.balance);paint(d);
      }).catch(netGate);
    }
    sub.textContent="consulting the ledger\u2026";
    load();
  }

  /* ---------- lobby ---------- */
  function renderLobby(me){
    clearTimer();VIEW="lobby";
    var w=column();
    // no shrine card here: the Shrine button in the header is the only way in
    // the pit first: the tables where the opponent is a person, not the house
    w.appendChild(el("div","seclabel","the pit — player against player"));
    var pit=el("div","casmenu pit");
    [["Tung, Wood, Fire","pit-tung"],["The Cut","pit-cut"],["Competitive Gambling","pit-comp"],["Poker","pit-poker"],["Chess","pit-chess"]].forEach(function(g){
      var b=el("button","casgame pvp");
      var ci=el("div","ci");ci.appendChild(gameIcon(g[1]));
      b.appendChild(ci);
      b.appendChild(el("div",null,g[0]));
      b.onclick=function(){openPlay(g[1]);};
      pit.appendChild(b);
    });
    w.appendChild(pit);
    w.appendChild(el("div","seclabel","the floor — you against tung"));
    w.appendChild(floorMenu(""));
    paintBars();
    w.appendChild(el("div","casnote","Sahurs have no cash value and can never be bought, sold, or cashed out."));
  }

  /* The house's own tables. The lobby and a live round both lay these out, and
     they lay out the same ones: a round is the whole floor, not a corner of it. */
  var FLOOR=[["Blackjack","blackjack"],["Roulette","roulette"],["Mines","mines"],
    ["Beef","beef"],["Limbo","limbo"],["Dice","dice"],["Plinko","plinko"]];
  function floorMenu(cls){
    var grid=el("div","casmenu"+(cls?" "+cls:""));
    FLOOR.forEach(function(g){
      var b=el("button","casgame");
      var ci=el("div","ci");ci.appendChild(gameIcon(g[1]));
      b.appendChild(ci);
      b.appendChild(el("div",null,g[0]));
      b.onclick=function(){openPlay(g[1]);};
      grid.appendChild(b);
    });
    return grid;
  }

  function openPlay(name){
    clearTimer();
    if(name.indexOf("pit-")===0)return viewPit(name.slice(4));
    if(name==="dice")return viewDice();
    if(name==="limbo")return viewLimbo();
    if(name==="roulette")return viewRoulette();
    if(name==="plinko")return viewPlinko();
    if(name==="blackjack")return viewBlackjack();
    if(name==="mines")return viewMines();
    if(name==="beef")return viewBeef();
  }

  /* ---------- shared scaffolding ---------- */
  /* every screen lives in one centred column so nothing pins to the left edge
     or sprawls across a wide desktop window */
  function column(){screen.innerHTML="";screen.classList.remove("pkpage");var w=el("div","caswrap");screen.appendChild(w);return w;}
  function mount(title,icon,paced){
    VIEW="game";
    var w=column();
    var back=el("button","casback","");
    paintBack(back,null);
    w.appendChild(back);
    var v=el("div","casview");
    var h=el("h3");
    h.appendChild(typeof icon==="string"?el("span",null,icon):icon);
    h.appendChild(el("span",null,title));
    /* the four tables that animate an outcome carry the lightning button; the
       ones where you are the thing taking time (mines, beef, blackjack) do not */
    if(paced)h.appendChild(boltBtn());
    v.appendChild(h);
    w.appendChild(v);
    paintBars();
    return v;
  }
  function betField(def){var i=el("input");i.type="number";i.min="0.1";i.step="0.1";i.value=def||"1";return i;}
  /* ---- picking a slow table back up ----
     Mines, beef and blackjack outlive the page they were dealt on: the stake
     leaves on the deal and the board is held server-side for hours. Closing the
     tab never ended one, it only hid it — and the next deal would overwrite it,
     taking the stake with it. Each of those three views asks this on open and
     paints whatever it finds, and tells you about the other two so a board is
     never open on a screen you are not looking at. */
  var OPEN_NAMES={mines:"a mines board",beef:"a beef walk",bj:"a blackjack hand"};
  function openGame(){
    return jget("/cas/resume?token="+encodeURIComponent(tok())).catch(function(){return null;});
  }
  /* what to say when the open board belongs to one of the other tables */
  function elsewhereNote(d,mine){
    if(!d||!d.game||d.game===mine)return "";
    return "you still have "+(OPEN_NAMES[d.game]||"a game")+" open.";
  }
  function ctl(label,node){var c=el("div","ctl");c.appendChild(el("span",null,label));c.appendChild(node);return c;}
  function selectOf(opts,def){var s=el("select");opts.forEach(function(o){var op=el("option",null,o[1]);op.value=o[0];s.appendChild(op);});if(def)s.value=def;return s;}
  function res(v){var r=el("div","casres","");v.appendChild(r);return r;}
  function ok(r,t){r.className="casres win";r.textContent=t;}
  function bad(r,t){r.className="casres lose";r.textContent=t;}
  function statBox(label){var s=el("div","stat");s.appendChild(el("b",null,label));var val=el("span",null,"-");s.appendChild(val);s.val=val;return s;}
  function pcell(label,cls){var c=el("div","pcell"+(cls?" "+cls:""));c.appendChild(el("b",null,label));var s=el("span",null,"-");c.appendChild(s);c.val=s;return c;}
  function divider(){return el("div","pdiv");}

  /* ---------- DICE ---------- */
  function viewDice(){
    var v=mount("Dice","🎲",true);
    var bet=betField("1");
    var row=el("div","ctlrow");
    row.appendChild(ctl("bet",bet));
    var seg=el("div","seg");
    var bUnder=el("button",null,"roll under");var bOver=el("button",null,"roll over");
    seg.appendChild(bUnder);seg.appendChild(bOver);
    row.appendChild(ctl("direction",seg));
    v.appendChild(row);

    var OVER=false, TARGET=50;
    var readout=el("div",null,"—");
    readout.style.cssText="text-align:center;font-size:34px;font-weight:800;color:#f2c063;font-variant-numeric:tabular-nums;padding:10px 0 6px;line-height:1";
    v.appendChild(readout);

    var wrap=el("div","dicewrap");
    var track=el("div","dtrack");
    var win=el("div","dwin");track.appendChild(win);
    var mark=el("div","dmark");mark.style.left="50%";track.appendChild(mark);
    var handle=el("div","dhandle");track.appendChild(handle);
    wrap.appendChild(track);
    var scale=el("div","dscale");
    ["0","25","50","75","100"].forEach(function(t){scale.appendChild(el("span",null,t));});
    wrap.appendChild(scale);
    v.appendChild(wrap);

    var stats=el("div","dstats");
    var sTarget=statBox("target"),sChance=statBox("win chance"),sPay=statBox("payout");
    stats.appendChild(sTarget);stats.appendChild(sChance);stats.appendChild(sPay);
    v.appendChild(stats);
    var r=res(v);
    var go=el("button","cbtn go","roll");v.appendChild(go);

    function paint(){
      bUnder.className=OVER?"":"on";bOver.className=OVER?"on":"";
      handle.style.left=TARGET+"%";
      if(OVER){win.style.left=TARGET+"%";win.style.right="0";win.style.width="auto";}
      else{win.style.left="0";win.style.width=TARGET+"%";win.style.right="auto";}
      var chance=OVER?(100-TARGET):TARGET;
      sTarget.val.textContent=(OVER?"> ":"< ")+TARGET.toFixed(0);
      sChance.val.textContent=chance.toFixed(0)+"%";
      sPay.val.textContent=(99/chance).toFixed(3)+"x";
    }
    function setTarget(t){TARGET=Math.min(98,Math.max(2,Math.round(t)));paint();}
    bUnder.onclick=function(){OVER=false;paint();};
    bOver.onclick=function(){OVER=true;paint();};
    function fromEvent(ev){
      var rect=track.getBoundingClientRect();
      var x=(ev.touches?ev.touches[0].clientX:ev.clientX)-rect.left;
      setTarget(x/rect.width*100);
    }
    var dragging=false;
    function down(ev){dragging=true;fromEvent(ev);ev.preventDefault();}
    function move(ev){if(dragging)fromEvent(ev);}
    function up(){dragging=false;}
    track.addEventListener("mousedown",down);track.addEventListener("touchstart",down,{passive:false});
    document.addEventListener("mousemove",move);document.addEventListener("touchmove",move,{passive:false});
    document.addEventListener("mouseup",up);document.addEventListener("touchend",up);
    paint();

    go.onclick=function(){
      go.disabled=true;r.className="casres";r.textContent="";
      roundBet(bet.value);
      jpost("/cas/dice",wager({bet:Number(bet.value),target:TARGET,over:OVER})).then(function(d){if(refused(d)){refusedGate();return;}
        if(d.error){go.disabled=false;roundSaw(d);bad(r,d.error);return;}
        // slide the marker to the rolled spot while the number counts up to it
        var from=parseFloat(mark.style.left)||0, to=d.roll, t0=Date.now(), dur=pace(1150,290);
        mark.style.background=d.win?"#6ee787":"#ff8080";
        mark.style.boxShadow="0 0 8px "+(d.win?"#6ee787":"#ff8080");
        mark.style.left=to+"%";
        readout.style.color="#f5efe0";
        (function tick(){
          var p=Math.min(1,(Date.now()-t0)/dur);
          var e=1-Math.pow(1-p,3);
          readout.textContent=(from+(to-from)*e).toFixed(2);
          if(p<1)requestAnimationFrame(tick);
          else{
            readout.textContent=to.toFixed(2);
            readout.style.color=d.win?"#6ee787":"#e0908a";
            go.disabled=false;setBal(d.balance);roundSaw(d);
            if(d.win){ok(r,"rolled "+d.roll.toFixed(2)+"  —  WIN "+mult(d.multiplier));celebrate(d.payout,d.multiplier);}
            else bad(r,"rolled "+d.roll.toFixed(2)+"  —  needed "+(d.over?"above ":"below ")+d.target+". lost.");
          }
        })();
      }).catch(function(){go.disabled=false;roundSaw(null);bad(r,"network error");});
    };
  }

  /* ---------- LIMBO ---------- */
  function viewLimbo(){
    var v=mount("Limbo","📈",true);
    var bet=betField("1");
    var tgt=el("input");tgt.type="number";tgt.min="1.01";tgt.step="0.01";tgt.value="2";
    var row=el("div","ctlrow");
    row.appendChild(ctl("bet",bet));row.appendChild(ctl("target x",tgt));
    v.appendChild(row);
    var big=el("div",null,"1.00x");
    big.style.cssText="font-size:46px;font-weight:800;text-align:center;padding:26px 0;color:#f2c063;font-variant-numeric:tabular-nums;line-height:1";
    v.appendChild(big);
    var r=res(v);
    var go=el("button","cbtn go","play");v.appendChild(go);
    go.onclick=function(){
      go.disabled=true;r.className="casres";r.textContent="";
      roundBet(bet.value);
      jpost("/cas/limbo",wager({bet:Number(bet.value),target:Number(tgt.value)})).then(function(d){if(refused(d)){refusedGate();return;}
        if(d.error){go.disabled=false;roundSaw(d);bad(r,d.error);return;}
        setBal(d.balance);
        var target=d.crash,t0=Date.now(),dur=pace(1900,420);
        big.style.color="#f5efe0";
        (function tick(){
          var p=Math.min(1,(Date.now()-t0)/dur);
          big.textContent=(1+(target-1)*(1-Math.pow(1-p,3))).toFixed(2)+"x";
          if(p<1)requestAnimationFrame(tick);
          else{
            big.textContent=target.toFixed(2)+"x";
            big.style.color=d.win?"#6ee787":"#e0908a";
            go.disabled=false;roundSaw(d);
            if(d.win){ok(r,"crashed at "+mult(d.crash)+"  —  WIN");celebrate(d.payout,d.multiplier);}
            else bad(r,"crashed at "+mult(d.crash)+"  —  needed "+mult(d.target)+". lost.");
          }
        })();
      }).catch(function(){go.disabled=false;roundSaw(null);bad(r,"network error");});
    };
  }

  /* ---------- ROULETTE ---------- */
  var WHEEL=[0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];
  var REDS={};[1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36].forEach(function(n){REDS[n]=1;});
  function colorOf(n){return n===0?"green":(REDS[n]?"red":"black");}
  function viewRoulette(){
    var v=mount("Roulette","◉",true);
    var bet=betField("1");
    var row=el("div","ctlrow");row.appendChild(ctl("bet",bet));v.appendChild(row);

    var SZ=320,C=SZ/2,R1=150,R2=92,step=360/37;
    var wrap=el("div","wheelwrap");
    var svg=sv("svg",{width:SZ,height:SZ,viewBox:"0 0 "+SZ+" "+SZ});
    var g=sv("g",{});g.setAttribute("class","wheel");
    function pt(rr,deg){var a=(deg-90)*Math.PI/180;return [C+rr*Math.cos(a),C+rr*Math.sin(a)];}
    WHEEL.forEach(function(n,i){
      var a0=i*step-step/2,a1=i*step+step/2;
      var o0=pt(R1,a0),o1=pt(R1,a1),i1=pt(R2,a1),i0=pt(R2,a0);
      var d="M"+o0[0]+" "+o0[1]+" A"+R1+" "+R1+" 0 0 1 "+o1[0]+" "+o1[1]+" L"+i1[0]+" "+i1[1]+" A"+R2+" "+R2+" 0 0 0 "+i0[0]+" "+i0[1]+" Z";
      var col=colorOf(n);
      g.appendChild(sv("path",{d:d,fill:col==="green"?"#1f6b32":(col==="red"?"#a32020":"#23232b"),stroke:"#0d0d10","stroke-width":"0.7"}));
      var tp=pt((R1+R2)/2,i*step);
      var tx=sv("text",{x:tp[0],y:tp[1],fill:"#fff","font-size":"9","font-weight":"700","text-anchor":"middle","dominant-baseline":"central",transform:"rotate("+(i*step)+" "+tp[0]+" "+tp[1]+")"});
      tx.textContent=String(n);g.appendChild(tx);
    });
    svg.appendChild(g);
    svg.appendChild(sv("circle",{cx:C,cy:C,r:R2-6,fill:"#2b1a0a",stroke:"#7a5a1a","stroke-width":"2"}));
    // the ball rides just inside the rim in its own group, spun the other way.
    // an inner group hops radially + wobbles a few pockets as it drops in.
    var ballG=sv("g",{});ballG.setAttribute("class","ball");
    var hop=sv("g",{});hop.setAttribute("class","ballhop");
    hop.appendChild(sv("circle",{cx:C,cy:C-(R1-11),r:5.5,fill:"#fff",stroke:"#1d1206","stroke-width":"1"}));
    hop.appendChild(sv("circle",{cx:C-1.6,cy:C-(R1-12.6),r:1.8,fill:"#ffffffee"}));
    ballG.appendChild(hop);
    svg.appendChild(ballG);
    wrap.appendChild(svg);v.appendChild(wrap);
    g.style.transformOrigin=C+"px "+C+"px";
    ballG.style.transformOrigin=C+"px "+C+"px";
    hop.style.transformOrigin=C+"px "+C+"px";
    hop.style.transformBox="view-box";

    var SEL={kind:"red",value:0};
    /* ---- the felt ----
       Laid out the way a roulette table actually is, which is the only layout
       that explains itself: zero down the left across all three number rows,
       the numbers in the rows they really sit in (3,6,9... along the top), and
       every outside bet touching what it covers — each column box at the end of
       its own row, each dozen spanning its twelve, the even-money bets two
       columns apiece along the bottom. Every chip carries what it pays.
       The rows ARE the server's columns: the top row is the multiples of three,
       and /cas/roulette calls that column 3 (it wins on spin%3===0). */
    var table=el("div","rtable");
    var cells={},outEls=[];
    function chip(cls,label,pay,kind,value,swatch){
      var c=el("div",cls);
      if(swatch)c.appendChild(el("span","rdiam "+swatch));
      c.appendChild(el("span",null,label));
      if(pay)c.appendChild(el("span","pay",pay));
      c.onclick=function(){SEL={kind:kind,value:value};paintSel();};
      c._k=kind;c._v=value;
      return c;
    }
    var zc=chip("rzero","0","35:1","number",0);
    cells[0]=zc;table.appendChild(zc);
    [[3,3],[2,2],[1,1]].forEach(function(spec,rowIdx){
      var first=spec[0],col=spec[1],gr=String(rowIdx+1);
      for(var k=0;k<12;k++){
        var num=first+k*3;
        var c=chip("rnum "+colorOf(num),String(num),"","number",num);
        c.style.gridColumn=String(k+2);c.style.gridRow=gr;
        cells[num]=c;table.appendChild(c);
      }
      var cb=chip("rcol","2 to 1","col "+col,"column",col);
      cb.style.gridColumn="14";cb.style.gridRow=gr;
      outEls.push(cb);table.appendChild(cb);
    });
    [["1st 12",1],["2nd 12",2],["3rd 12",3]].forEach(function(dz,i){
      var c=chip("rdozen",dz[0],"2:1","dozen",dz[1]);
      c.style.gridColumn=(2+i*4)+" / span 4";c.style.gridRow="4";
      outEls.push(c);table.appendChild(c);
    });
    [["low","1-18",null],["even","Even",null],["red","Red","red"],
     ["black","Black","black"],["odd","Odd",null],["high","19-36",null]].forEach(function(o,i){
      var c=chip("reven",o[1],"1:1",o[0],0,o[2]);
      c.style.gridColumn=(2+i*2)+" / span 2";c.style.gridRow="5";
      outEls.push(c);table.appendChild(c);
    });
    v.appendChild(table);
    /* and the bet in words underneath, because a gold ring around one chip on a
       felt this size is easy to lose */
    var pickBar=el("div","rpick");
    var pickTxt=el("b",null,"");
    var pickPay=el("span","pay","");
    pickBar.appendChild(el("span",null,"betting"));
    pickBar.appendChild(pickTxt);pickBar.appendChild(pickPay);
    v.appendChild(pickBar);
    var NAMES={red:"Red",black:"Black",odd:"Odd",even:"Even",low:"1-18",high:"19-36"};
    var ORD=["","1st","2nd","3rd"];
    function paintSel(){
      for(var n=0;n<=36;n++)cells[n].classList.toggle("sel",SEL.kind==="number"&&SEL.value===n);
      outEls.forEach(function(b){b.classList.toggle("sel",SEL.kind!=="number"&&b._k===SEL.kind&&b._v===(SEL.value||0));});
      pickTxt.textContent=SEL.kind==="number"?("number "+SEL.value):
        (SEL.kind==="dozen"?(ORD[SEL.value]+" 12"):
        (SEL.kind==="column"?("column "+SEL.value):(NAMES[SEL.kind]||SEL.kind)));
      pickPay.textContent="pays "+(SEL.kind==="number"?"35:1":
        ((SEL.kind==="dozen"||SEL.kind==="column")?"2:1":"1:1"));
    }
    var r=res(v);
    var go=el("button","cbtn go","spin");v.appendChild(go);
    paintSel();

    var rot=0, brot=0;
    go.onclick=function(){
      go.disabled=true;r.className="casres";r.textContent="spinning...";
      /* the wheel and the ball read these two properties rather than a duration
         baked into the stylesheet, so the lightning button changes how long the
         spin lasts and nothing else. fewer turns when it is short, or a quick
         spin is just a blur. */
      var spinMs=pace(7000,1800), turns=pace(5,3), bturns=pace(7,4);
      svg.style.setProperty("--spin",(spinMs/1000)+"s");
      svg.style.setProperty("--ballspin",(spinMs*0.93/1000)+"s");
      roundBet(bet.value);
      jpost("/cas/roulette",wager({bet:Number(bet.value),kind:SEL.kind,value:SEL.value})).then(function(d){if(refused(d)){refusedGate();return;}
        if(d.error){go.disabled=false;roundSaw(d);bad(r,d.error);return;}
        var idx=WHEEL.indexOf(d.spin);
        /* where on the rim this one comes to rest — anywhere, not always the
           top. the wheel carries the winning pocket round to that spot and the
           ball, orbiting the other way, stops over it (the pocket is still the
           server's; only where it happens to stop on screen is chosen here) */
        var land=Math.random()*360;
        // wheel forward so the winning pocket ends at the landing spot
        rot += 360*turns + ((((land - idx*step) - rot) % 360) + 360) % 360;
        g.style.transform="rotate("+rot+"deg)";
        // ball orbits the other way, ends over the same spot, then hops between
        // pockets as it drops in
        brot -= 360*bturns + (((brot - land) % 360) + 360) % 360;
        ballG.classList.remove("dropping");
        void ballG.getBoundingClientRect();
        ballG.classList.add("dropping");
        ballG.style.transform="rotate("+brot+"deg)";
        setTimeout(function(){
          go.disabled=false;setBal(d.balance);roundSaw(d);
          var label=d.spin+" "+d.color;
          if(d.win){ok(r,label+"  —  WIN "+mult(d.multiplier));celebrate(d.payout,d.multiplier);}
          else bad(r,label+"  —  lost.");
        },spinMs+150);
      }).catch(function(){go.disabled=false;roundSaw(null);bad(r,"network error");});
    };
  }

  /* ---------- PLINKO ---------- */
  function viewPlinko(){
    var v=mount("Plinko",icoPlinko(),true);
    var bet=betField("1");
    var risk=selectOf([["low","Low"],["medium","Medium"],["high","High"]],"medium");
    var rows=selectOf([["8","8"],["12","12"],["16","16"]],"12");
    var row=el("div","ctlrow");
    row.appendChild(ctl("bet",bet));row.appendChild(ctl("risk",risk));row.appendChild(ctl("rows",rows));
    v.appendChild(row);

    var TABLES={
      low:{8:[5.6,2.1,1.1,1,0.5,1,1.1,2.1,5.6],12:[10,3,1.6,1.4,1.1,1,0.5,1,1.1,1.4,1.6,3,10],16:[16,9,2,1.4,1.4,1.2,1.1,1,0.5,1,1.1,1.2,1.4,1.4,2,9,16]},
      medium:{8:[13,3,1.3,0.7,0.4,0.7,1.3,3,13],12:[33,11,4,2,1.1,0.6,0.3,0.6,1.1,2,4,11,33],16:[110,41,10,5,3,1.5,1,0.5,0.3,0.5,1,1.5,3,5,10,41,110]},
      high:{8:[29,4,1.5,0.3,0.2,0.3,1.5,4,29],12:[170,24,8.1,2,0.7,0.2,0.2,0.2,0.7,2,8.1,24,170],16:[1000,130,26,9,4,2,0.2,0.2,0.2,0.2,0.2,2,4,9,26,130,1000]}
    };
    // board and buckets live in ONE fixed-width box so the ball's landing x and
    // the bucket centres are measured on the exact same scale
    var board=el("div","plinkboard");
    var boardWrap=el("div","plinkwrap");board.appendChild(boardWrap);
    var buckets=el("div","pbuckets");board.appendChild(buckets);
    v.appendChild(board);
    var r=res(v);
    var go=el("button","cbtn go","drop");v.appendChild(go);

    /* ---- the board ----
       One fixed-width box holds the pegs and the buckets, so a ball's landing x
       and a bucket's centre are measured on the same scale. A ball that has
       taken k hops sits at x = cx + (2*rights - k)*bw/2, and after the last row
       that works out to exactly (bucket + 0.5)*bw, the centre of its bucket. */
    var W=300,svg=null,cx=W/2,bw=0,rowH=0,topY=22,R=12,PEGS=[],ballLayer=null;
    function build(){
      R=Number(rows.value);bw=W/(R+1);rowH=Math.min(20,240/R);
      var H=topY+R*rowH+20;
      boardWrap.innerHTML="";PEGS=[];BALLS=[];
      // no width/height attributes: CSS gives it width:100%;height:auto so the
      // viewBox scales uniformly to the shared board width (x maps 1:1 to buckets)
      svg=sv("svg",{viewBox:"0 0 "+W+" "+H,preserveAspectRatio:"xMidYMid meet"});
      for(var rr=0;rr<R;rr++){
        PEGS[rr]=[];
        for(var i=0;i<=rr;i++){
          var peg=sv("circle",{cx:cx+(i-rr/2)*bw,cy:topY+rr*rowH,r:2.2,fill:"#7a5a1a"});
          svg.appendChild(peg);PEGS[rr][i]=peg;
        }
      }
      /* the balls go in a layer above the pegs, so one is never swallowed by a
         peg it is bouncing off */
      ballLayer=sv("g",{});svg.appendChild(ballLayer);
      boardWrap.appendChild(svg);
      var tab=TABLES[risk.value][R];
      buckets.innerHTML="";
      tab.forEach(function(m){
        var b=el("div","pb",m+"x");
        b.style.background=m>=2?"#8a5a28":(m>=1?"#3a2410":"#5a2020");
        buckets.appendChild(b);
      });
    }

    /* ---- the fall ----
       Where a ball ends up is the server's: its path is a left or a right per row
       and the ball has to land on the bucket they add up to. Everything here is
       about making the fall look like one, and none of it can move the landing:
       the waypoints are computed straight from that path, and the animation
       only decides how long the ball takes to get between them.

       Each hop is one peg row. The ball slides across at a steady rate, falls
       with y going as t squared so it accelerates the way a dropped thing does,
       and kicks a little off the peg it just clipped. That kick is what reads
       as a bounce rather than a bead running down a wire. */
    /* read per frame rather than captured, so flipping the lightning button
       with balls already in the air speeds up the hops they have left */
    function hopMs(){return pace(215,54);}
    var POP=0.34, MAX_BALLS=8;
    var BALLS=[],raf=null,flying=0,issued=0,applied=0,pending=null;
    function pegFlash(rr,i){
      var peg=PEGS[rr]&&PEGS[rr][i];
      if(!peg)return;
      peg.setAttribute("fill","#f2c063");peg.setAttribute("r","3.2");
      setTimeout(function(){peg.setAttribute("fill","#7a5a1a");peg.setAttribute("r","2.2");},150);
    }
    /* every point the ball passes through, worked out from the server's path
       before a single frame is drawn: waypoint k is the peg it clips on row k,
       and the last one is the floor of the bucket it belongs in */
    function wayPoints(path){
      var pts=[],rights=0,k;
      for(k=0;k<=path.length;k++){
        pts.push({x:cx+(2*rights-k)*bw/2,y:topY+k*rowH,peg:k<path.length?rights:-1,row:k});
        if(k<path.length)rights+=path[k];
      }
      var last=pts[pts.length-1];
      pts.push({x:last.x,y:last.y+14,peg:-1,row:-1});   // into the bucket
      return {pts:pts,bucket:rights};
    }
    function spawn(d){
      var w=wayPoints(d.path);
      var node=sv("circle",{cx:w.pts[0].x,cy:w.pts[0].y-rowH*1.6,r:4.5,fill:"#f2c063",stroke:"#1d1206","stroke-width":"1"});
      ballLayer.appendChild(node);
      BALLS.push({
        d:d,node:node,pts:w.pts,bucket:w.bucket,i:0,
        x0:w.pts[0].x,y0:w.pts[0].y-rowH*1.6,t0:0,done:false
      });
      flying++;
      if(!raf)raf=requestAnimationFrame(tick);
    }
    function land(b){
      b.done=true;
      var bel=buckets.children[b.bucket];
      if(bel){bel.classList.add("hit");setTimeout(function(){bel.classList.remove("hit");},420);}
      if(b.node.parentNode)b.node.parentNode.removeChild(b.node);
      var d=b.d;
      flying--;
      /* the balance is whichever answer the server issued LAST, not whichever
         ball landed last: two drops in the air can come back out of order */
      if(d.seq>applied){applied=d.seq;setBal(d.balance);}
      if(!pending||d.seq>=pending.seq)pending=d;
      /* a wager is not over until the table has finished showing it, and with
         several in the air that is when the last of them lands */
      if(flying<=0){
        if(pending){roundSaw(pending);pending=null;}
        rows.disabled=false;risk.disabled=false;
      }
      if(d.multiplier>1){ok(r,"landed "+mult(d.multiplier));celebrate(d.payout,d.multiplier);}
      else bad(r,"landed "+mult(d.multiplier)+"  (+"+money(d.payout)+")");
    }
    function tick(now){
      raf=null;
      var alive=false;
      for(var n=0;n<BALLS.length;n++){
        var b=BALLS[n];
        if(b.done)continue;
        if(!b.t0)b.t0=now;
        var to=b.pts[b.i];
        var t=(now-b.t0)/hopMs();
        if(t>=1){
          b.node.setAttribute("cx",to.x);b.node.setAttribute("cy",to.y);
          if(to.peg>=0)pegFlash(to.row,to.peg);
          b.x0=to.x;b.y0=to.y;b.t0=now;b.i++;
          if(b.i>=b.pts.length){land(b);continue;}
          t=0;
          to=b.pts[b.i];
        }
        /* x slides across at a steady rate; y goes as t squared, so the ball
           accelerates downward; the sine term is the kick off the peg */
        var x=b.x0+(to.x-b.x0)*t;
        var y=b.y0+(to.y-b.y0)*t*t-Math.sin(Math.PI*t)*rowH*POP*(1-t*0.45);
        b.node.setAttribute("cx",x);b.node.setAttribute("cy",y);
        alive=true;
      }
      BALLS=BALLS.filter(function(x){return !x.done;});
      if(alive||BALLS.length)raf=requestAnimationFrame(tick);
    }

    rows.onchange=build;risk.onchange=build;build();

    go.onclick=function(){
      /* the board takes several balls at once, so the button does not lock —
         it only refuses to put up more than can be read at a glance */
      if(BALLS.length>=MAX_BALLS){bad(r,"let a few of those land first.");return;}
      r.className="casres";r.textContent="";
      /* the row and risk pickers rebuild the board, which would strand a ball
         mid-air, so they are held while any is falling */
      rows.disabled=true;risk.disabled=true;
      roundBet(bet.value);
      var seq=++issued, drop=R;
      jpost("/cas/plinko",wager({bet:Number(bet.value),risk:risk.value,rows:drop})).then(function(d){if(refused(d)){refusedGate();return;}
        if(d.error){
          if(!flying){rows.disabled=false;risk.disabled=false;roundSaw(d);}
          bad(r,d.error);return;
        }
        /* the board was rebuilt under this drop: pay it, but do not try to
           animate it down a board it was never dropped on */
        if(drop!==R){
          setBal(d.balance);if(!flying)roundSaw(d);
          ok(r,"landed "+mult(d.multiplier));
          return;
        }
        d.seq=seq;
        spawn(d);
      }).catch(function(){
        if(!flying){rows.disabled=false;risk.disabled=false;roundSaw(null);}
        bad(r,"network error");
      });
    };
  }

  /* ---------- BLACKJACK ---------- */
  /* a card with a back and a front; the deal animation spins it face-up */
  function cardEl(c){
    var wrap=el("div","pcard"+(c==="??"?" hole":""));
    var inner=el("div","pcinner");
    var back=el("div","pcface pcback","♠");
    var front=el("div","pcface pcfront");
    if(c!=="??"){
      if(c.indexOf("♥")>=0||c.indexOf("♦")>=0)front.className="pcface pcfront red";
      front.textContent=c;
    }
    inner.appendChild(back);inner.appendChild(front);
    wrap.appendChild(inner);
    return wrap;
  }
  /* one icon per action so the buttons read at a glance */
  function strokePath(d,w){return sv("path",{d:d,fill:"none",stroke:"currentColor","stroke-width":w||"2.4","stroke-linecap":"round","stroke-linejoin":"round"});}
  function icoBox(){return sv("svg",{viewBox:"0 0 24 24",width:"20",height:"20","aria-hidden":"true"});}
  function icoHit(){var s=icoBox();s.appendChild(strokePath("M12 4v13"));s.appendChild(strokePath("M6 12l6 6 6-6"));return s;}
  function icoStand(){var s=icoBox();s.appendChild(strokePath("M5 11h14","2.9"));var p=strokePath("M5 16h14","2.9");p.setAttribute("opacity",".45");s.appendChild(p);return s;}
  function icoDouble(){var s=icoBox();s.appendChild(strokePath("M6 5l6 6 6-6"));s.appendChild(strokePath("M6 13l6 6 6-6"));return s;}
  function icoDeal(){var s=icoBox();s.appendChild(sv("rect",{x:"4",y:"5",width:"9",height:"13",rx:"2",fill:"none",stroke:"currentColor","stroke-width":"2"}));
    s.appendChild(sv("rect",{x:"11",y:"7",width:"9",height:"13",rx:"2",fill:"none",stroke:"currentColor","stroke-width":"2",opacity:".55"}));return s;}
  function icoSplit(){var s=icoBox();s.appendChild(strokePath("M12 20v-6"));s.appendChild(strokePath("M12 14l-5-5"));s.appendChild(strokePath("M12 14l5-5"));return s;}
  function bjBtn(cls,label,icon){var b=el("button","bjbtn "+cls);b.appendChild(icon);b.appendChild(el("span",null,label));return b;}
  /* The server only ever reports the total of a finished hand, so a hand that is
     still being dealt has to be counted here: aces are 11 until that busts, and
     the hole card is worth nothing while it is still face down. */
  function bjCardValue(c){
    var r=c.slice(0,c.length-1);
    if(r==="A")return 11;
    if(r==="K"||r==="Q"||r==="J"||r==="10")return 10;
    return Number(r)||0;
  }
  function bjTotal(cards){
    var total=0,aces=0;
    cards.forEach(function(c){
      if(c==="??")return;
      var v=bjCardValue(c);total+=v;if(v===11)aces++;
    });
    while(total>21&&aces>0){total-=10;aces--;}
    return total;
  }
  var BJ_DEAL_MS=400;                  // beat between one card landing and the next
  function bjCopyShown(shown){
    return {dealer:shown.dealer.slice(),hands:shown.hands.map(function(h){return h.slice();})};
  }
  function bjApplyShown(shown,ev){
    if(ev.t==="D"){
      if(typeof ev.at==="number")shown.dealer[ev.at]=ev.c;
      else shown.dealer.push(ev.c);
    }else{
      if(!shown.hands[ev.h])shown.hands[ev.h]=[];
      if(typeof ev.at==="number")shown.hands[ev.h][ev.at]=ev.c;
      else shown.hands[ev.h].push(ev.c);
    }
  }
  /* Server order is already [upcard, hole, ...hits] — the hole sits to the
     right of the card you can see, same as a real shoe. During play the hole
     is still "??". Do not swap them: putting the hole on the left made a
     stand wipe the upcard and deal it again. */
  function bjDealerView(d){
    return (d.dealer||[]).slice();
  }
  function bjSameCards(a,b){
    if(!a||!b||a.length!==b.length)return false;
    for(var i=0;i<a.length;i++)if(a[i]!==b[i])return false;
    return true;
  }
  function bjSyncSplits(shown,d){
    if(!d.hands)return;
    while(shown.hands.length<d.hands.length){
      var k=0;
      while(k<shown.hands.length&&bjSameCards(shown.hands[k],d.hands[k].cards))k++;
      var moved=(k<shown.hands.length&&shown.hands[k].length)?shown.hands[k].pop():null;
      shown.hands.splice(Math.min(k+1,shown.hands.length),0,moved?[moved]:[]);
    }
  }
  function bjIsOpening(shown){
    return shown.dealer.length===0&&shown.hands.every(function(h){return !h.length;});
  }
  function bjPrepareShown(shown,d){
    var cur=bjCopyShown(shown);
    if(!bjIsOpening(cur))bjSyncSplits(cur,d);
    return cur;
  }
  /* Opening deal is you, upcard, you, hole — so the hole lands on the right
     of the card you can already see. Anything after that — a hit, the hole
     turning over, the dealer drawing to 17 — is appended in that order so
     the renderer can sleep BJ_DEAL_MS between each card. */
  function bjDealQueue(shown,d){
    var cur=bjPrepareShown(shown,d);
    var q=[];
    if(bjIsOpening(shown)){
      var p=(d.hands[0]&&d.hands[0].cards)||[];
      var up=(d.dealer&&d.dealer[0])||"";
      if(p[0])q.push({t:"P",h:0,c:p[0]});
      if(up)q.push({t:"D",c:up});
      if(p[1])q.push({t:"P",h:0,c:p[1]});
      q.push({t:"D",c:"??"});
      q.forEach(function(ev){bjApplyShown(cur,ev);});
    }else{
      (d.hands||[]).forEach(function(h,i){
        if(!cur.hands[i])cur.hands[i]=[];
        (h.cards||[]).forEach(function(c,j){
          if(cur.hands[i][j]!==c){
            var ev={t:"P",h:i,c:c};
            if(cur.hands[i][j]!==undefined)ev.at=j;
            q.push(ev);
            bjApplyShown(cur,ev);
          }
        });
      });
    }
    bjDealerView(d).forEach(function(c,j){
      if(cur.dealer[j]!==c){
        var ev={t:"D",c:c};
        if(cur.dealer[j]!==undefined)ev.at=j;
        q.push(ev);
        bjApplyShown(cur,ev);
      }
    });
    return q;
  }
  window.__bj={DEAL_MS:BJ_DEAL_MS,dealerView:bjDealerView,dealQueue:bjDealQueue,apply:bjApplyShown,prepare:bjPrepareShown,total:bjTotal};
  function viewBlackjack(){
    var v=mount("Blackjack",icoBlackjack());
    var bet=betField("1");
    var deal=bjBtn("deal","deal",icoDeal());
    var row=el("div","ctlrow");
    row.appendChild(ctl("bet",bet));row.appendChild(ctl(" ",deal));
    v.appendChild(row);

    // the table: dealer above, your hand(s) below, everything centred
    var table=el("div","bjtable");
    var dlab=el("div","bjlabel","dealer"),dval=el("div","bjval","-"),dcards=el("div","bjcards");
    var plab=el("div","bjlabel","you"),phands=el("div","bjhands");
    [dlab,dval,dcards,el("div","bjsplit"),plab,phands].forEach(function(x){table.appendChild(x);});
    v.appendChild(table);

    var acts=el("div","bjacts");v.appendChild(acts);   // actions sit under your hand
    var r=el("div","bjres","");v.appendChild(r);
    function setRes(cls,txt){r.className="bjres"+(cls?" "+cls:"");r.textContent=txt;}

    /* One reply carries everything that just happened — after a stand that is
       the hole card plus every card the dealer draws on top of it. Laying all of
       it down at once hands the player the result before they have seen a single
       card, so only the cards already on the felt are painted. Fresh ones wait
       BJ_DEAL_MS behind the last. The result line, the balance, the payout toast
       and the next set of buttons all wait for the last card to land. */
    var shown={dealer:[],hands:[[]]};
    /* settle() owns the result line and runs after the cards finish landing,
       so a note written before paint() would be wiped by it. This rides through
       instead, and is spent the first time it is shown. */
    var resumeNote="";
    var handUI=[];
    var dealTimer=null;
    var live=null;                       // server snapshot for the hand in motion

    /* Cards keep their DOM node between paints, because rebuilding one that is
       already on the table would restart its deal animation. Only the index that
       actually changed is replaced — a prefix wipe used to throw away the
       upcard when the hole flipped, so stand looked like the dealer was dealt
       twice. "??" turning into a real card is still a change, and that is the
       hole's flip. */
    function paintCards(wrap,cards){
      while(wrap.children.length>cards.length)wrap.removeChild(wrap.lastChild);
      for(var i=0;i<cards.length;i++){
        if(i<wrap.children.length&&wrap.children[i]._card===cards[i])continue;
        var e=cardEl(cards[i]);e._card=cards[i];
        if(i<wrap.children.length)wrap.replaceChild(e,wrap.children[i]);
        else wrap.appendChild(e);
      }
    }
    function ensureHands(){
      while(handUI.length<shown.hands.length){
        var ui={box:el("div","bjhand"),tag:el("div","bjhtag"),val:el("div","bjval","-"),wrap:el("div","bjcards")};
        ui.box.appendChild(ui.tag);ui.box.appendChild(ui.val);ui.box.appendChild(ui.wrap);
        phands.appendChild(ui.box);
        handUI.push(ui);
      }
    }
    function dealerShownValue(){
      var vis=shown.dealer.some(function(c){return c!=="??";});
      return vis?String(bjTotal(shown.dealer)):"?";
    }
    function renderShown(){
      ensureHands();
      var multi=shown.hands.length>1||(live&&live.hands&&live.hands.length>1);
      paintCards(dcards,shown.dealer);
      dval.textContent=shown.dealer.length?dealerShownValue():"-";
      phands.className="bjhands"+(multi?" multi":"");
      shown.hands.forEach(function(cards,i){
        var ui=handUI[i];if(!ui)return;
        ui.tag.style.display=multi?"":"none";
        ui.tag.className="bjhtag";
        ui.tag.textContent="hand "+(i+1);
        ui.val.textContent=cards.length?String(bjTotal(cards)):"-";
        paintCards(ui.wrap,cards);
      });
      plab.textContent=multi?("your hands ("+shown.hands.length+")"):"you";
    }
    function stopDeal(){if(dealTimer){clearTimeout(dealTimer);dealTimer=null;}}
    function clearTable(){
      stopDeal();
      shown={dealer:[],hands:[[]]};
      handUI=[];live=null;
      dcards.innerHTML="";phands.innerHTML="";acts.innerHTML="";
      dval.textContent="-";plab.textContent="you";
      table.classList.remove("bjdealing");
    }
    var LABEL={blackjack:"BLACKJACK!",win:"you win!",dealer_bust:"dealer busts - you win!",push:"push - bet returned",lose:"dealer wins",bust:"you bust",dealer_blackjack:"dealer blackjack"};

    // every card is down, so the round can now be given away
    function settle(d){
      var multi=d.hands.length>1;
      handUI.forEach(function(ui,i){
        var hd=d.hands[i];if(!hd)return;
        ui.box.className="bjhand"+(d.state==="playing"&&i===d.active?" active":"")+(hd.done&&d.state!=="playing"?" settled":"");
        if(multi&&hd.result){
          ui.tag.className="bjhtag"+((hd.payout>hd.bet)?" win":(hd.result==="push"?"":" lose"));
          ui.tag.textContent=LABEL[hd.result]||hd.result;
        }
      });
      acts.innerHTML="";
      if(d.state==="playing"){
        var hit=bjBtn("hit","hit",icoHit());hit.onclick=function(){act("/cas/bj/hit");};
        var stand=bjBtn("stand","stand",icoStand());stand.onclick=function(){act("/cas/bj/stand");};
        acts.appendChild(hit);acts.appendChild(stand);
        var stake=(d.hands[d.active]||{}).bet||0;
        if(d.canDouble){var db=bjBtn("dbl","double",icoDouble());db.onclick=function(){act("/cas/bj/double",stake);};acts.appendChild(db);}
        if(d.canSplit){var sp=bjBtn("split","split",icoSplit());sp.onclick=function(){act("/cas/bj/split",stake);};acts.appendChild(sp);}
        setRes("",resumeNote||(multi?("playing hand "+(d.active+1)+" of "+d.hands.length):""));
        resumeNote="";
        return;
      }
      // the server sends the new balance with the first reply, but the header and
      // the win toast have to wait until the dealer has finished taking cards
      if(typeof d.balance==="number")setBal(d.balance);
      roundSaw(d);
      if(multi){
        // a split round is summarised by what came back versus what was staked
        var net=Math.round((d.payout-d.bet)*100)/100;
        setRes(net>0?"win":(net<0?"lose":""),
          net>0?("you take "+money(d.payout)+" on "+money(d.bet)+" staked"):
          (net<0?("you lose "+money(-net)):"push - stake returned"));
      }else{
        var msg=LABEL[d.result]||d.result;
        if(d.result==="push")setRes("",msg);
        else if(d.payout>0)setRes("win",msg);
        else setRes("lose",msg);
      }
      if(d.payout>d.bet)celebrate(d.payout,d.bet?d.payout/d.bet:1);
      deal.disabled=false;bet.disabled=false;
    }
    function playQueue(q,done){
      var n=0;
      var t0=Date.now();
      function tick(){
        dealTimer=null;
        if(!table.isConnected)return;    // left the table part way through a round
        if(n>=q.length){done();return;}
        bjApplyShown(shown,q[n]);
        n+=1;
        renderShown();
        // schedule from t0 so a slow paint cannot collapse the 0.4s gaps
        var wait=Math.max(0,(t0+n*BJ_DEAL_MS)-Date.now());
        dealTimer=window.setTimeout(tick,wait);
      }
      tick();
    }
    function paint(d){
      stopDeal();
      live=d;
      if(d.state==="playing")roundStaked(d);   /* the stake is out; the hand is not read */
      var q=bjDealQueue(shown,d);
      shown=bjPrepareShown(shown,d);
      renderShown();
      table.classList.add("bjdealing");
      acts.innerHTML="";
      playQueue(q,function(){
        table.classList.remove("bjdealing");
        settle(d);
      });
    }
    /* the second argument is the extra stake a double or a split pushes out;
       hit and stand cost nothing, and either way what the hand is worth is not
       settled until the dealer is done */
    function act(p,more){
      Array.prototype.forEach.call(acts.querySelectorAll("button"),function(b){b.disabled=true;});
      if(more)roundBet(more);
      jpost(p,{}).then(function(d){if(refused(d)){refusedGate();return;}if(d.error){if(more)roundSaw(d);setRes("lose",d.error);deal.disabled=false;bet.disabled=false;return;}paint(d);})
        .catch(function(){if(more)roundSaw(null);setRes("lose","network error");deal.disabled=false;bet.disabled=false;});
    }
    deal.onclick=function(){
      deal.disabled=true;bet.disabled=true;
      clearTable();setRes("","");        // a new round deals every card fresh
      roundBet(bet.value);
      jpost("/cas/bj/start",wager({bet:Number(bet.value)})).then(function(d){if(refused(d)){refusedGate();return;}
        if(d.error){roundSaw(d);setRes("lose",d.error);deal.disabled=false;bet.disabled=false;return;}
        paint(d);
      }).catch(function(){roundSaw(null);setRes("lose","network error");deal.disabled=false;bet.disabled=false;});
    };
    /* a hand left on the felt is still there — paint() takes the server's own
       state either way, so a resumed hand deals in exactly like a fresh one and
       the hole card stays down until it is earned */
    openGame().then(function(d){
      if(!d||d.error)return;
      if(d.game==="bj"){
        bet.value=money(d.bet);
        deal.disabled=true;bet.disabled=true;
        resumeNote="you left this hand on the felt.";
        paint(d);
      }else{
        var note=elsewhereNote(d,"bj");
        if(note)setRes("lose",note);
      }
    });
  }

  /* ---------- MINES ---------- */
  function viewMines(){
    var v=mount("Mines","💣");
    var bet=betField("1");
    var mn=el("input");mn.type="number";mn.min="1";mn.max="24";mn.step="1";mn.value="3";
    var start=el("button","cbtn go","start");
    var cash=el("button","cbtn stop","cash out");cash.style.display="none";
    var row=el("div","ctlrow");
    row.appendChild(ctl("bet",bet));row.appendChild(ctl("mines",mn));
    var bwrap=el("div","casrow");bwrap.appendChild(start);bwrap.appendChild(cash);
    row.appendChild(ctl(" ",bwrap));
    v.appendChild(row);
    // dedicated readout panel
    var panel=el("div","panel");
    var pCur=pcell("current"),pNext=pcell("next"),pFound=pcell("💎 found","gem"),pLeft=pcell("💎 left","gem");
    panel.appendChild(pCur);panel.appendChild(divider());panel.appendChild(pNext);
    panel.appendChild(divider());panel.appendChild(pFound);panel.appendChild(divider());panel.appendChild(pLeft);
    v.appendChild(panel);
    var grid=el("div","grid5");v.appendChild(grid);
    var r=res(v);
    var cells=[],live=false,safeTotal=0;
    function build(active){
      grid.innerHTML="";cells=[];
      for(var i=0;i<25;i++){(function(idx){
        var c=el("div","cell"+(active?"":" dis"),"");cells.push(c);
        c.onclick=function(){if(live)pick(idx,c);};grid.appendChild(c);
      })(i);}
    }
    build(false);
    function setPanel(cur,next,found){
      pCur.val.textContent=cur;pNext.val.textContent=next;
      pFound.val.textContent=found;pLeft.val.textContent=Math.max(0,safeTotal-found);
    }
    setPanel("—","—","0");
    function enableHidden(){cells.forEach(function(x){if(!x.classList.contains("safe")&&!x.classList.contains("mine"))x.classList.remove("dis");});}
    function endRound(){live=false;cash.style.display="none";start.style.display="";bet.disabled=false;mn.disabled=false;
      cells.forEach(function(c){c.classList.add("dis");});}
    function pick(idx,c){
      live=false;cells.forEach(function(x){x.classList.add("dis");});
      jpost("/cas/mines/pick",{tile:idx}).then(function(d){if(refused(d)){refusedGate();return;}
        if(d.error){bad(r,d.error);live=true;enableHidden();return;}
        if(d.state==="boom"){
          c.className="cell mine";c.textContent="💣";
          (d.mines||[]).forEach(function(m){if(cells[m]){cells[m].className="cell mine";cells[m].textContent="💣";}});
          setBal(d.balance);roundSaw(d);bad(r,"boom. you lost.");endRound();return;
        }
        c.className="cell safe dis";c.textContent="💎";
        /* the last gem is a cashout, but it still has to write the panel */
        setPanel(mult(d.multiplier),d.nextMultiplier!=null?mult(d.nextMultiplier):"—",(d.revealed||[]).length);
        if(d.state==="cashout"){setBal(d.balance);roundSaw(d);ok(r,"cleared the board! "+mult(d.multiplier));celebrate(d.payout,d.multiplier);endRound();return;}
        cash.textContent="cash out "+mult(d.multiplier);
        live=true;enableHidden();
      }).catch(function(){bad(r,"network error");live=true;enableHidden();});
    }
    /* the board as it stands, whether it was just dealt or is being picked up
       hours later. The revealed list is the tiles already turned over. */
    function enterBoard(d,count,revealed){
      revealed=revealed||[];
      safeTotal=25-count;
      start.style.display="none";cash.style.display="";bet.disabled=true;mn.disabled=true;
      build(true);live=true;
      revealed.forEach(function(i){
        if(cells[i]){cells[i].className="cell safe dis";cells[i].textContent="💎";}
      });
      enableHidden();
      setPanel(revealed.length?mult(d.multiplier):"1.00x",
        d.nextMultiplier!=null?mult(d.nextMultiplier):"—",revealed.length);
      cash.textContent=revealed.length?("cash out "+mult(d.multiplier)):"cash out";
    }
    start.onclick=function(){
      start.disabled=true;
      /* the stake is on the board from the moment it is dealt; what it is worth
         is the thing that waits for the board to be read */
      roundBet(bet.value);
      jpost("/cas/mines/start",wager({bet:Number(bet.value),mines:Number(mn.value)})).then(function(d){if(refused(d)){refusedGate();return;}
        start.disabled=false;
        if(d.error){roundSaw(d);bad(r,d.error);return;}
        roundStaked(d);
        setBal(BAL-Number(bet.value));
        r.className="casres";r.textContent="";
        enterBoard(d,Number(mn.value),[]);
      }).catch(function(){start.disabled=false;roundSaw(null);bad(r,"network error");});
    };
    /* a board left open is still on the server; put the player back on it */
    openGame().then(function(d){
      if(!d||d.error)return;
      if(d.game==="mines"){
        bet.value=money(d.bet);mn.value=String(d.mines);
        enterBoard(d,Number(d.mines),d.revealed);
        ok(r,"you left this board open. the stake is still on it.");
      }else{
        var note=elsewhereNote(d,"mines");
        if(note)bad(r,note);
      }
    });
    cash.onclick=function(){
      cash.disabled=true;
      jpost("/cas/mines/cashout",{}).then(function(d){if(refused(d)){refusedGate();return;}
        cash.disabled=false;
        if(d.error){bad(r,d.error);return;}
        setBal(d.balance);roundSaw(d);(d.mines||[]).forEach(function(m){if(cells[m]&&!cells[m].classList.contains("safe")){cells[m].className="cell mine";cells[m].textContent="💣";}});
        ok(r,"cashed out "+mult(d.multiplier));celebrate(d.payout,d.multiplier);endRound();
      }).catch(function(){cash.disabled=false;bad(r,"network error");});
    };
  }

  /* ---------- BEEF ---------- */
  function viewBeef(){
    var v=mount("Beef","🐄");
    var bet=betField("1");
    var diff=selectOf([["easy","Easy"],["medium","Medium"],["hard","Hard"],["daredevil","Daredevil"]],"easy");
    var start=el("button","cbtn go","start");
    var step=el("button","cbtn","step →");step.style.display="none";
    var cash=el("button","cbtn stop","cash out");cash.style.display="none";
    var row=el("div","ctlrow");
    row.appendChild(ctl("bet",bet));row.appendChild(ctl("difficulty",diff));
    var bwrap=el("div","casrow");bwrap.appendChild(start);bwrap.appendChild(step);bwrap.appendChild(cash);
    row.appendChild(ctl(" ",bwrap));
    v.appendChild(row);
    var panel=el("div","panel");
    var pLane=pcell("lane"),pCur=pcell("current"),pNext=pcell("next");
    panel.appendChild(pLane);panel.appendChild(divider());panel.appendChild(pCur);panel.appendChild(divider());panel.appendChild(pNext);
    v.appendChild(panel);
    var road=el("div","road");v.appendChild(road);
    var r=res(v);
    var LANES=0,STEP=0;
    /* the ladder is the server's own list of what each lane pays, so the road and
       the till can never quote different numbers. An older server that does not
       send one leaves the rungs unlabelled rather than guessing: the panel's
       current/next are server-sent and stay right either way. */
    function build(n,ladder){
      road.innerHTML="";
      for(var i=1;i<=n;i++){
        var L=el("div","rlane");
        var rung=(ladder&&ladder[i-1]);
        L.appendChild(el("div","lm",rung?Number(rung).toFixed(2)+"x":""));
        L.appendChild(el("div","lc",""));
        L.appendChild(el("div",null,String(i)));
        // traffic in every lane the cow has not reached
        var car=el("div","car","🚗");
        car.style.animationDuration=(1.0+Math.random()*1.4).toFixed(2)+"s";
        car.style.animationDelay=(-Math.random()*2.4).toFixed(2)+"s";
        L.appendChild(car);
        road.appendChild(L);
      }
      var st=road.children[0];if(st)st.classList.add("cur");
    }
    function placeAnimal(idx){
      Array.prototype.forEach.call(road.children,function(L,i){
        L.classList.remove("cur");
        L.querySelector(".lc").textContent="";
        if(i<idx)L.classList.add("done");
      });
      var cur=road.children[idx];
      if(cur){cur.classList.add("cur");cur.querySelector(".lc").textContent="🐄";cur.scrollIntoView({block:"nearest",inline:"center"});}
    }
    function running(on){start.style.display=on?"none":"";step.style.display=on?"":"none";cash.style.display=on?"":"none";bet.disabled=on;diff.disabled=on;}
    /* the road as it stands, freshly dealt or picked up hours later */
    function enterRoad(d){
      LANES=d.lanes;STEP=Number(d.step)||0;
      build(LANES,d.ladder);running(true);
      if(STEP>0){
        placeAnimal(STEP-1);
        if(road.children[STEP-1])road.children[STEP-1].classList.add("done");
        cash.style.display="";cash.textContent="cash out "+mult(d.multiplier);
      }else cash.style.display="none";
      pLane.val.textContent=STEP+" / "+LANES;
      pCur.val.textContent=STEP?mult(d.multiplier):"1.00x";
      pNext.val.textContent=mult(d.nextMultiplier);
    }
    start.onclick=function(){
      start.disabled=true;
      roundBet(bet.value);
      jpost("/cas/beef/start",wager({bet:Number(bet.value),difficulty:diff.value})).then(function(d){if(refused(d)){refusedGate();return;}
        start.disabled=false;
        if(d.error){roundSaw(d);bad(r,d.error);return;}
        roundStaked(d);
        setBal(BAL-Number(bet.value));
        r.className="casres";r.textContent="";
        enterRoad(d);
      }).catch(function(){start.disabled=false;roundSaw(null);bad(r,"network error");});
    };
    /* a cow left in the road is still there; put the player back beside it */
    openGame().then(function(d){
      if(!d||d.error)return;
      if(d.game==="beef"){
        bet.value=money(d.bet);
        if(d.difficulty)diff.value=d.difficulty;
        enterRoad(d);
        ok(r,"you left this one in the road. the stake is still on it.");
      }else{
        var note=elsewhereNote(d,"beef");
        if(note)bad(r,note);
      }
    });
    step.onclick=function(){
      step.disabled=true;
      jpost("/cas/beef/step",{}).then(function(d){if(refused(d)){refusedGate();return;}
        if(d.error){step.disabled=false;bad(r,d.error);return;}
        if(d.state==="dead"){
          // walk into the lane, let a car flatten him, THEN report it
          placeAnimal(d.step-1);
          var L=road.children[d.step-1]||road.children[LANES-1];
          var car=L&&L.querySelector(".car");
          if(car){car.style.display="block";car.className="car hit";}
          setTimeout(function(){
            if(L){L.classList.remove("cur");L.classList.add("boom");L.querySelector(".lc").textContent="💥";}
            step.disabled=false;setBal(d.balance);roundSaw(d);
            bad(r,"splat. the cow didn't make it.");running(false);
          },560);
          return;
        }
        step.disabled=false;
        STEP=d.step;placeAnimal(STEP-1);
        road.children[STEP-1].classList.add("done");
        if(d.state==="cashout"){setBal(d.balance);roundSaw(d);ok(r,"made it across! "+mult(d.multiplier));celebrate(d.payout,d.multiplier);running(false);return;}
        cash.style.display="";cash.textContent="cash out "+mult(d.multiplier);
        pLane.val.textContent=STEP+" / "+LANES;pCur.val.textContent=mult(d.multiplier);pNext.val.textContent=mult(d.nextMultiplier);
      }).catch(function(){step.disabled=false;bad(r,"network error");});
    };
    cash.onclick=function(){
      cash.disabled=true;
      jpost("/cas/beef/cashout",{}).then(function(d){if(refused(d)){refusedGate();return;}
        cash.disabled=false;
        if(d.error){bad(r,d.error);return;}
        setBal(d.balance);roundSaw(d);ok(r,"cashed out "+mult(d.multiplier));celebrate(d.payout,d.multiplier);running(false);
      }).catch(function(){cash.disabled=false;bad(r,"network error");});
    };
  }

  /* ---------- THE PIT (player vs player) ---------- */
  /* Two tables where the opponent is another member rather than the house. The
     client holds no rules at all: it posts create/join/confirm/move and paints
     whatever the server says the duel now looks like. It never learns the other
     player's pick until the server has both, because the server does not send
     it — so there is nothing here to read out of devtools and nothing to time.

     Every screen here is driven by one poll (pitPoll) and one countdown tick
     (pitTick), both owned by PIT and both torn down by clearTimer(), which every
     navigation already calls. */
  var PIT={game:null,id:null,poll:null,tick:null,skew:0,shape:"",left:null,node:null,reveal:[],
    busy:false,pending:null,roundsSeen:null,last:null,chips:null,pkSeen:null,pkHand:null,pkAuto:false,pkAutoBusy:false,pkUp:null,pkUpAt:0,pkRaise:false,pkShow:false,pkAmt:0,pkKeys:null,pkKeyBound:null,pkTalkBtn:null};
  /* the clash: the beat between a round resolving and the next one starting */
  var CL_IN_MS=520, CL_HIT_MS=600, CL_SAY_MS=1000, CL_HOLD_MS=2050;
  /* How a cut is dealt. There is nothing to play in this game — both cards are
     decided before either is shown — so the entire experience is the wait, and
     it is paced deliberately: the deck is cut, your card stirs and turns over
     slowly, you sit with it for three full seconds while THEIR card starts to
     shiver, and only then does it turn. The result is held back behind the
     second card, because knowing the outcome early is the one thing that would
     make the pause worthless. */
  var CUT_STIR_MS=250;    /* a card wakes up before it turns */
  var CUT_FIRST_MS=700;   /* yours turns */
  var CUT_FLIP_MS=900;    /* and takes this long doing it — slow on purpose */
  var CUT_GAP_MS=3000;    /* start to start between the two cards */
  var CUT_TEASE_MS=1000;  /* their card starts shivering this long beforehand */
  var PIT_GAMES={
    tung:{name:"Tung, Wood, Fire",moves:["tung","wood","fire"],
      blurb:"tung splits the wood. the wood feeds the fire. the fire takes tung.",
      sub:"first to two rounds. a tie is no round at all — play it again."},
    cut:{name:"The Cut",moves:[],
      blurb:"one card each. the high card takes the pot.",
      sub:"nothing to play. the deck is cut the moment everyone at the table says yes. a tie is re-cut."},
    comp:{name:"Competitive Gambling",moves:[],
      blurb:"three minutes on the floor. a stack of wood each. the biggest pile at the buzzer takes the pot.",
      sub:"two, three or four of you, the whole floor, played in wood. it is not sahurs and never becomes sahurs \u2014 it is handed out for the round and swept when it ends, while your sahurs sit in the pot the whole time. run the wood out with nothing left on a table and you are done, and the round ends the moment there is nobody left to play against. finish level at the top and the pot is split."},
    poker:{name:"Poker",moves:[],
      blurb:"everyone buys in for the same stake. everyone gets the same chips. it ends when one of you has all of them.",
      sub:"no limit hold'em, two to five of you. put a table up and anybody can sit down at it \u2014 you deal when you are ready, so you are never left waiting on a fifth who is not coming. the chips are dealt by the table and are worth nothing off it: your sahurs sit in the pot the whole time and go to whoever is last standing. the blinds go up every three minutes and do not stop going up, so it finishes."},
    chess:{name:"Chess",moves:[],
      blurb:"a board, two of you, and the rules. play it for nothing, or put sahurs on it.",
      sub:"the server holds the position and checks every move against it, so an illegal one never lands. each of you has your own clock, running only while it is your move \u2014 run it out and you lose, unless the other one has nothing left to mate with."}
  };

  /* ---- the chess board ----
     The server owns the rules; this draws the position it sent and offers the
     moves it listed. The legal list arrives as UCI strings for whoever is to
     move, so picking a piece is a filter over that list rather than a second
     copy of the rulebook out here, where it could disagree. */
  /* ---- what a piece is drawn with ----
     A proper piece set if one has been dropped into games/tung/pieces/, and the
     glyphs otherwise. The set is probed once, with one image: asking for all
     twelve and letting them fail would flash twelve broken images on a board
     that has none. Until the probe answers the glyphs are used, so the board is
     never empty waiting for it. Names are the usual wP/bN form, so a set
     downloaded from anywhere is already named right. */
  var SOLIDP={p:"\u265F",n:"\u265E",b:"\u265D",r:"\u265C",q:"\u265B",k:"\u265A"};
  function pcGlyph(ch){return SOLIDP[String(ch).toLowerCase()]||"";}
  /* Which theme, and where its twelve files are coming from. Two probes, one
     image each: the repo's own copy first, then chess.com's host. Whichever
     answers is used for the rest of the session; if neither does, the glyphs
     stay, because a board of broken images is worse than a plain one. */
  var PC_KEY="shrine-pieces";
  var PC_SRC=null;          /* the base URL the set is coming from, once known */
  var PC_TRIED={};          /* theme -> true once it has been asked about */
  function pcTheme(){
    var t="";
    try{t=localStorage.getItem(PC_KEY)||"";}catch(e){}
    if(typeof PIECE_THEMES==="undefined")return t||"neo";
    return PIECE_THEMES.indexOf(t)>=0?t:PIECE_THEMES[0];
  }
  function pcSetTheme(t){
    try{localStorage.setItem(PC_KEY,t);}catch(e){}
    PC_SRC=null;PC_TRIED={};pcProbe();
    if(PIT.last&&PIT.last.game==="chess"){PIT.shape="";pitRender(PIT.last);}
  }
  function pcFile(ch){
    /* chess.com names them lowercase, colour then piece: wq.png, bb.png */
    return (ch===ch.toUpperCase()?"w":"b")+String(ch).toLowerCase()+".png";
  }
  function pcProbe(){
    var theme=pcTheme();
    if(PC_TRIED[theme])return;
    PC_TRIED[theme]=true;
    var tries=[];
    if(typeof PIECES_BASE!=="undefined"&&PIECES_BASE)tries.push(PIECES_BASE+theme+"/");
    if(typeof PIECE_REMOTE!=="undefined"&&PIECE_REMOTE)tries.push(PIECE_REMOTE+theme+"/150/");
    var i=0;
    var next=function(){
      if(i>=tries.length)return;              /* neither answered — keep the glyphs */
      var base=tries[i++];
      var im=new Image();
      im.onload=function(){
        PC_SRC=base;
        if(PIT.last&&PIT.last.game==="chess"){PIT.shape="";pitRender(PIT.last);}
      };
      im.onerror=next;
      im.src=base+"wp.png";
    };
    next();
  }
  /* one piece, as an image if there is a set and as a glyph if there is not */
  function pcEl(ch){
    var white=ch===ch.toUpperCase();
    if(PC_SRC){
      var i=document.createElement("img");
      i.className="chp img "+(white?"w":"b");
      i.src=PC_SRC+pcFile(ch);
      i.alt="";i.draggable=false;
      return i;
    }
    return el("span","chp"+(white?" w":" b"),pcGlyph(ch));
  }
  function fenBoard(fen){
    /* FEN's first rank is rank 8; the array that comes back is indexed the
       same way the squares are named, 0 = a8 across to 63 = h1 */
    var out=[],rows=String(fen||"").split(" ")[0].split("/");
    for(var r=0;r<8;r++){
      var row=rows[r]||"8";
      for(var i=0;i<row.length;i++){
        var c=row.charAt(i);
        if(c>="1"&&c<="8"){for(var k=0;k<Number(c);k++)out.push("");}
        else out.push(c);
      }
    }
    return out;
  }
  function sqName(idx){ /* idx is 0 = a8 */
    return "abcdefgh".charAt(idx%8)+String(8-Math.floor(idx/8));
  }
  /* ---- built once, repainted in place ----
     A move used to be a whole new screen. The poll saw a different FEN, the
     shape gate in pitRender() failed, and the entire casino view came down and
     went back up — back button, header, names, pot, clock, board and panel. On
     the receiving end that reads as the board flashing every time the other
     person moves, because that is exactly what it is; thirty-two fresh <img>
     elements on top of it, each of which has to come back out of cache and
     decode before its square stops being empty.

     So the skeleton is built once per game and nothing after that rebuilds it.
     chessPaint() walks the sixty-four squares and changes only what differs,
     and the piece that MOVED is carried across as the element it already was
     rather than a new one, so its image never reloads. pitRender() sends a
     position-only change straight to chessPaint() instead of re-mounting.

     The handlers are bound to the board once and now outlive the position that
     was on it when they were attached, so they read the live one out of 'ui'
     rather than off the arguments they were built with. */
  function chessBoard(body,d,note){
    var c=d.chess;if(!c)return;
    pcProbe();
    var flip=c.youAre==="b";
    var wrap=el("div","chwrap");
    var boardEl=el("div","chboard");
    var squares={},base={};
    var order=[];
    for(var q=0;q<64;q++)order.push(flip?63-q:q);
    order.forEach(function(idx){
      var name=sqName(idx);
      var file=idx%8,rank=Math.floor(idx/8);
      var dark=((file+rank)%2)===1;
      var cls="chsq"+(dark?" dk":" lt");
      var sq=el("div",cls);
      sq.setAttribute("data-sq",name);
      /* the coordinates, on the edges only, the way a board is printed. They
         belong to the square rather than to whatever is standing on it, so they
         go down once here and are never touched again. */
      if((flip?file===7:file===0))sq.appendChild(el("span","chrk",String(8-rank)));
      if((flip?rank===0:rank===7))sq.appendChild(el("span","chfl","abcdefgh".charAt(file)));
      squares[name]=sq;base[name]=cls;
      boardEl.appendChild(sq);
    });
    wrap.appendChild(boardEl);

    /* the side panel: who is who, the clock, the moves, and the two buttons
       that end a game without a mate on the board. The two that come and go get
       an empty slot each rather than being appended when they turn up, so the
       order down the panel is settled at build time. The .chslot wrapper is
       display:contents, so a slot with nothing in it is not a gap. */
    var side=el("div","chside");
    var top=el("div","chwho");
    top.appendChild(el("span","chdot "+(c.youAre==="w"?"b":"w")));
    var topName=el("span","chname","…");
    top.appendChild(topName);
    var topClock=el("div","chclock","");
    top.appendChild(topClock);
    side.appendChild(top);
    var st=el("div","chstate","");
    side.appendChild(st);
    var mv=el("div","chmoves");
    side.appendChild(mv);
    var offerSlot=el("div","chslot");
    side.appendChild(offerSlot);
    var actsSlot=el("div","chslot");
    side.appendChild(actsSlot);
    /* your own name and clock at the foot of the panel, the way a board is laid
       out everywhere: theirs at the top, yours at the bottom */
    var mine=el("div","chwho");
    mine.appendChild(el("span","chdot "+(c.youAre==="w"?"w":"b")));
    mine.appendChild(el("span","chname","you"));
    var botClock=el("div","chclock","");
    mine.appendChild(botClock);
    side.appendChild(mine);
    wrap.appendChild(side);
    body.appendChild(wrap);

    PIT.chUI={
      id:d.id,board:boardEl,squares:squares,base:base,
      topName:topName,st:st,mv:mv,offer:offerSlot,acts:actsSlot,sanN:0,
      d:d,c:c,cells:[],legal:[],note:note
    };
    PIT.chClocks={top:topClock,bot:botClock,view:c};
    chessHand(boardEl,PIT.chUI);
    chessPaint(d,note);
  }
  /* everything a move changes, and nothing it does not */
  function chessPaint(d,note){
    var ui=PIT.chUI;if(!ui)return;
    var c=d.chess;if(!c)return;
    var cells=fenBoard(c.fen);
    var legal=c.legal||[];
    /* the handlers read all of this, so it is replaced before anything is drawn
       rather than after */
    ui.d=d;ui.c=c;ui.cells=cells;ui.legal=legal;
    if(note)ui.note=note;
    if(PIT.chClocks)PIT.chClocks.view=c;

    var picked=PIT.chFrom||null;
    var i,n,sq,nm;
    /* where the picked piece could go, so the squares can be dotted — and which
       squares hold something that can be picked up at all, which is the only
       place the cursor has any business offering to pick anything up. The
       server sends 'legal' only to whoever is to move, so on their turn this is
       empty and the whole board is an ordinary arrow. */
    var targets={},grabs={};
    for(i=0;i<legal.length;i++){
      grabs[legal[i].slice(0,2)]=1;
      if(picked&&legal[i].slice(0,2)===picked)targets[legal[i].slice(2,4)]=1;
    }
    /* the king in check gets lit, the way it is on any board worth using */
    var chkSq=null;
    if(!c.result&&c.check){
      var want=c.toAct==="w"?"K":"k";
      for(var ck=0;ck<64;ck++)if(cells[ck]===want){chkSq=sqName(ck);break;}
    }

    /* ---- the pieces ----
       A square whose piece has not changed is left completely alone. One that
       has gives its element up to a pool BEFORE anything is put down, so the
       piece that moved lands on its new square as the very element it already
       was — image included, already decoded — instead of a fresh <img> that has
       to be fetched back out of cache first. */
    var pool={},fill=[],old,have,wantPc;
    for(n=0;n<64;n++){
      nm=sqName(n);
      sq=ui.squares[nm];if(!sq)continue;
      wantPc=cells[n]||"";
      old=sq.querySelector(".chp");
      /* the attribute is worth trusting only while there is something standing
         there to trust it about, and "?" can never match a piece — so a square
         that disagrees with itself is simply redrawn */
      have=old?(sq.getAttribute("data-pc")||"?"):"";
      if(have===wantPc)continue;
      if(old&&old.parentNode){
        old.parentNode.removeChild(old);
        if(!pool[have])pool[have]=[];
        pool[have].push(old);
      }
      sq.setAttribute("data-pc",wantPc);
      if(wantPc)fill.push([sq,wantPc,nm]);
    }
    for(n=0;n<fill.length;n++){
      var pc=fill[n][1];
      var pe=(pool[pc]&&pool[pc].length)?pool[pc].pop():pcEl(pc);
      pe.style.visibility=(PIT.chDrag===fill[n][2])?"hidden":"";
      fill[n][0].appendChild(pe);
    }

    /* ---- and the squares under them ---- */
    for(n=0;n<64;n++){
      nm=sqName(n);
      sq=ui.squares[nm];if(!sq)continue;
      var cls=ui.base[nm];
      if(c.lastFrom===nm||c.lastTo===nm)cls+=" last";
      if(chkSq===nm)cls+=" chk";
      if(picked===nm)cls+=" from";
      if(grabs[nm])cls+=" pick";
      if(targets[nm])cls+=cells[n]?" take":" go";
      if(sq.className!==cls)sq.className=cls;
    }

    /* ---- the panel ---- */
    ui.topName.textContent=(c.youAre==="w"?c.black:c.white)||"…";
    var stTxt,stCls="chstate";
    if(c.result){
      stTxt=c.result==="d"?("draw — "+c.reason)
        :((c.result===c.youAre?"you win":"you lose")+" — "+c.reason);
      stCls="chstate over";
    }else{
      stTxt=(c.yourTurn?"your move":"their move")+(c.check?" — check":"");
      if(c.check)stCls="chstate check";
    }
    if(ui.st.textContent!==stTxt)ui.st.textContent=stTxt;
    if(ui.st.className!==stCls)ui.st.className=stCls;

    /* The scoresheet only ever grows, so rows are appended rather than the list
       being thrown away and written out again — which also threw away where it
       was scrolled to, on the one part of this panel anybody scrolls. A long
       game now follows its own last move instead of sitting at move one. */
    var san=c.san||[];
    if(san.length<ui.sanN){ui.mv.innerHTML="";ui.sanN=0;}
    var grew=san.length>ui.sanN;
    while(ui.sanN<san.length){
      i=ui.sanN;
      if(i%2===0){
        var line=el("div","chmvrow");
        line.appendChild(el("span","chmvn",String(i/2+1)+"."));
        line.appendChild(el("span","chmv",san[i]||""));
        line.appendChild(el("span","chmv",""));
        ui.mv.appendChild(line);
      }else{
        var row=ui.mv.lastChild;
        if(row&&row.childNodes[2])row.childNodes[2].textContent=san[i]||"";
      }
      ui.sanN++;
    }
    if(grew)ui.mv.scrollTop=ui.mv.scrollHeight;

    /* the two slots. Small enough to write out each time, and they only ever
       change on a move, so nothing is being rebuilt under a hand reaching for
       it — an unchanged position never reaches this function at all. */
    ui.offer.innerHTML="";ui.acts.innerHTML="";
    if(!c.result){
      if(c.drawFrom&&c.drawFrom!==c.youAre){
        var off=el("div","choffer");
        off.appendChild(el("span","",(c.youAre==="w"?c.black:c.white)+" offers a draw"));
        var take=el("button","cbtn go","accept");
        take.onclick=function(){chessAct(ui.d,"draw",ui.note);};
        var no=el("button","cbtn","decline");
        no.onclick=function(){chessAct(ui.d,"unoffer",ui.note);};
        off.appendChild(take);off.appendChild(no);
        ui.offer.appendChild(off);
      }
      var acts=el("div","chacts");
      var dr=el("button","cbtn",c.drawFrom===c.youAre?"draw offered":"offer draw");
      dr.disabled=c.drawFrom===c.youAre;
      dr.onclick=function(){chessAct(ui.d,"draw",ui.note);};
      var rs=el("button","cbtn","resign");
      rs.onclick=function(){if(confirm("resign this game?"))chessAct(ui.d,"resign",ui.note);};
      acts.appendChild(dr);acts.appendChild(rs);
      ui.acts.appendChild(acts);
    }
    chPaintClocks();
  }
  /* ---- picking a piece up, both ways ----
     Drag it, or click the square and click where it goes \u2014 which is what
     lichess and chess.com both do, and the difference between them is only
     whether the pointer moved before it came back up. Pointer events rather
     than mouse ones, so a finger works the same as a cursor. */
  /* Bound to the board ONCE, and the board now outlives every position that is
     ever on it — so nothing in here may close over the arguments it was built
     with. Everything it needs it reads out of the live "ui" record, which
     chessPaint() replaces wholesale before it draws anything. Closing over
     "legal" here was how a board that stopped being rebuilt would have kept
     offering last move's moves. */
  function chessHand(boardEl,ui){
    var drag=null;
    /* whether there is anything to pick up at all, asked afresh on every press
       rather than once when the handlers went on */
    var live=function(){return !!(ui.c&&ui.c.yourTurn&&!ui.c.result);};
    var squareAt=function(x,y){
      var e=document.elementFromPoint(x,y);
      while(e&&e!==boardEl){
        if(e.classList&&e.classList.contains("chsq"))return e.getAttribute("data-sq");
        e=e.parentNode;
      }
      return null;
    };
    var sqEl=function(n){return boardEl.querySelector('.chsq[data-sq="'+n+'"]');};
    var movesFrom=function(n){
      var out={},lg=ui.legal||[];
      for(var i=0;i<lg.length;i++)if(lg[i].slice(0,2)===n)out[lg[i].slice(2,4)]=1;
      return out;
    };
    /* A render in the middle of a drag would throw away the element the pointer
       was captured on and the drop would never arrive — which is why the render
       guard stands a poll down while a piece is in hand. Picking one up
       therefore paints the hints straight onto the squares that are already
       there, and nothing re-renders until the move is sent or it is put back
       down. */
    var hint=function(from,tg){
      var i,all=boardEl.querySelectorAll(".chsq");
      for(i=0;i<all.length;i++)all[i].classList.remove("from","go","take","over");
      if(!from)return;
      var f=sqEl(from);
      if(f)f.classList.add("from");
      for(var n in tg){
        if(!Object.prototype.hasOwnProperty.call(tg,n))continue;
        var t=sqEl(n);
        if(t)t.classList.add(occupied(n)?"take":"go");
      }
    };
    var occupied=function(n){
      var cells=ui.cells||[];
      for(var i=0;i<64;i++)if(sqName(i)===n)return !!cells[i];
      return false;
    };
    var send=function(from,to){
      var uci=from+to,lg=ui.legal||[];
      /* a pawn reaching the last rank has to say what it becomes; the server
         refuses the move without it */
      if(lg.indexOf(uci)<0&&lg.indexOf(uci+"q")>=0)chessPromote(ui.d,uci,ui.note);
      else if(lg.indexOf(uci)>=0)chessMove(ui.d,uci,ui.note);
      else{PIT.chFrom=null;hint(null,{});}
    };
    var drop=function(){
      if(!drag)return;
      if(drag.el&&drag.el.parentNode)drag.el.parentNode.removeChild(drag.el);
      if(drag.hidden)drag.hidden.style.visibility="";
      boardEl.classList.remove("held");
      drag=null;PIT.chDrag=null;
    };
    boardEl.addEventListener("pointerdown",function(ev){
      if(!live())return;
      var name=squareAt(ev.clientX,ev.clientY);
      if(!name)return;
      ev.preventDefault();
      /* already aiming at this square: that is the move, click or drag */
      if(PIT.chFrom&&movesFrom(PIT.chFrom)[name]){var f=PIT.chFrom;PIT.chFrom=null;send(f,name);return;}
      var tg=movesFrom(name);
      var any=false;
      for(var k in tg){if(Object.prototype.hasOwnProperty.call(tg,k)){any=true;break;}}
      if(!any){PIT.chFrom=null;hint(null,{});return;}
      PIT.chFrom=name;
      hint(name,tg);
      var idx=-1;
      for(var i=0;i<64;i++)if(sqName(i)===name){idx=i;break;}
      var piece=idx>=0?(ui.cells||[])[idx]:"";
      if(!piece)return;
      var box=boardEl.getBoundingClientRect(),size=box.width/8;
      var g=el("div","chdrag");
      g.appendChild(pcEl(piece));
      g.style.width=size+"px";g.style.height=size+"px";
      g.style.fontSize=(size*0.82)+"px";g.style.left="0px";g.style.top="0px";
      document.body.appendChild(g);
      var sqel=sqEl(name),hidden=sqel?sqel.querySelector(".chp"):null;
      if(hidden)hidden.style.visibility="hidden";
      drag={from:name,el:g,size:size,moved:false,targets:tg,hidden:hidden};
      /* the render guard reads this: while a piece is in hand the poll must not
         rebuild the board and take the pointer capture with it */
      PIT.chDrag=name;
      /* and the cursor says the piece is being carried, not just hovered */
      boardEl.classList.add("held");
      g.style.transform="translate("+(ev.clientX-size/2)+"px,"+(ev.clientY-size/2)+"px)";
      try{boardEl.setPointerCapture(ev.pointerId);}catch(e){}
    });
    boardEl.addEventListener("pointermove",function(ev){
      if(!drag)return;
      drag.moved=true;
      drag.el.style.transform="translate("+(ev.clientX-drag.size/2)+"px,"+(ev.clientY-drag.size/2)+"px)";
      var name=squareAt(ev.clientX,ev.clientY);
      var was=boardEl.querySelector(".chsq.over");
      if(was&&was.getAttribute("data-sq")!==name)was.classList.remove("over");
      if(name&&drag.targets[name]){var sq=sqEl(name);if(sq)sq.classList.add("over");}
    });
    boardEl.addEventListener("pointerup",function(ev){
      if(!drag)return;
      var from=drag.from,moved=drag.moved,tg=drag.targets;
      var name=squareAt(ev.clientX,ev.clientY);
      drop();
      try{boardEl.releasePointerCapture(ev.pointerId);}catch(e){}
      /* dropped somewhere it can go — play it. Let go without moving and it
         stays picked up, which is the click half of click-to-move. */
      if(moved&&name&&name!==from&&tg[name]){PIT.chFrom=null;send(from,name);return;}
      if(moved&&name!==from){PIT.chFrom=null;hint(null,{});}
    });
    boardEl.addEventListener("pointercancel",function(){drop();PIT.chFrom=null;hint(null,{});});
  }
  /* ---- your own move, before the server has heard about it ----
     The server still decides: this only moves the piece on screen so the board
     answers the hand that moved it instead of freezing for a round trip. The
     reply repaints from the position the server actually holds, so anything
     guessed wrong here lives for about as long as it takes to be corrected.
     What is guessed: the rook that comes with a castling king, the pawn that
     is taken past, and what a promoting pawn turns into. Not whether the move
     was legal — the server said that before it was offered. */
  function chessGuess(uci,c){
    var boardEl=document.querySelector(".chboard");
    if(!boardEl)return;
    var from=uci.slice(0,2),to=uci.slice(2,4),promo=uci.slice(4,5);
    var sqEl=function(n){return boardEl.querySelector('.chsq[data-sq="'+n+'"]');};
    var f=sqEl(from),t=sqEl(to);
    if(!f||!t)return;
    var pc=f.querySelector(".chp");
    if(!pc)return;
    var mover=pc.className.indexOf(" w")>=0||pc.className.indexOf("img w")>=0?"w":"b";
    var isKing=false,isPawn=false;
    /* which piece it is, read off what is drawn rather than off a rulebook */
    if(pc.tagName==="IMG")
      {isKing=/k\.png$/.test(pc.src);isPawn=/p\.png$/.test(pc.src);}
    else
      {isKing=pc.textContent==="\u265A";isPawn=pc.textContent==="\u265F";}
    var file=function(n){return n.charCodeAt(0)-97;};
    /* What a square is holding is written on the square, because chessPaint()
       reads it to work out which squares actually changed \u2014 and this moves
       pieces about behind its back. Every hand that takes a piece off a square
       or puts one down here says so, or the next repaint would be diffing
       against a board that no longer exists. */
    var mark=function(sq,pcName){sq.setAttribute("data-pc",pcName||"");};
    /* A square holds more than its piece: the ones down the edges carry the
       rank and file they are printed with. Empty it with innerHTML and the
       coordinates go too, and stay gone until the server's reply redraws the
       board — so only the piece is ever taken off. */
    var put=function(sq,piece,pcName){
      var had=sq.querySelector(".chp");
      if(had&&had.parentNode)had.parentNode.removeChild(had);
      sq.appendChild(piece);
      mark(sq,pcName);
    };
    var moving=f.getAttribute("data-pc")||"";
    /* the rook goes with the king */
    if(isKing&&Math.abs(file(to)-file(from))===2){
      var rank=from.charAt(1);
      var rf=file(to)>file(from)?"h":"a", rt=file(to)>file(from)?"f":"d";
      var r0=sqEl(rf+rank),r1=sqEl(rt+rank);
      if(r0&&r1){
        var rk=r0.querySelector(".chp");
        if(rk){put(r1,rk,r0.getAttribute("data-pc")||"");mark(r0,"");}
      }
    }
    /* a pawn that goes diagonally onto an empty square took one in passing */
    if(isPawn&&file(to)!==file(from)&&!t.querySelector(".chp")){
      var gone=sqEl(to.charAt(0)+from.charAt(1));
      if(gone){
        var g=gone.querySelector(".chp");
        if(g&&g.parentNode)g.parentNode.removeChild(g);
        mark(gone,"");
      }
    }
    /* A promotion puts a NEW piece down, so the pawn has to be picked up by
       hand — appendChild moves the piece it is given, which is what takes an
       ordinary move off its own square, and a queen is not the pawn. Without
       this the pawn sat on the seventh rank beside its own new queen for the
       length of the round trip. */
    if(promo&&pc.parentNode)pc.parentNode.removeChild(pc);
    var landed=promo?(mover==="w"?promo.toUpperCase():promo.toLowerCase()):moving;
    put(t,promo?pcEl(landed):pc,landed);
    mark(f,"");
    /* light the move and take the hints down, so it reads as played */
    var all=boardEl.querySelectorAll(".chsq");
    for(var i=0;i<all.length;i++)all[i].classList.remove("from","go","take","over","last");
    f.classList.add("last");t.classList.add("last");
    /* and start their clock, because it is their move now */
    if(c&&c.clock&&c.running===c.yourSeat){
      var now=Date.now()+PIT.skew;
      c.clock[c.yourSeat]=Math.max(0,c.clock[c.yourSeat]-Math.max(0,now-c.since))+(c.inc||0);
      c.since=now;c.running=1-c.yourSeat;c.yourTurn=false;
      chPaintClocks();
    }
    /* the panel has to agree with the board: it said "your move" a moment ago
       and the move has been made. The scoresheet is left to the server — the
       client does not own the rules and cannot spell the move in algebraic. */
    var stEl=document.querySelector(".chstate");
    if(stEl&&stEl.className.indexOf("over")<0)
      {stEl.textContent="their move";stEl.className="chstate";}
  }
  function chessMove(d,uci,note){
    PIT.chFrom=null;
    /* paint it first, then tell the server */
    chessGuess(uci,d.chess);
    /* and hold the next render, so the poll does not put the piece back where
       it was in the half second before the reply lands */
    PIT.chSent=true;
    pitSend("/duel/chess",{id:d.id,move:uci},function(e){
      PIT.chSent=false;PIT.shape="";pitRender(PIT.last);
      bad(note,e==="illegal move"?"not a legal move.":(e||"that did not go through."));
    }).then(function(){
      /* the reply already went through pitRender, which this gate turned away —
         so lift it and paint the position the server actually holds, rather
         than leaving the guess up until the next poll comes round */
      PIT.chSent=false;
      if(PIT.last)pitRender(PIT.last);
    });
  }
  function chessAct(d,action,note){
    PIT.chFrom=null;
    pitSend("/duel/chess",{id:d.id,action:action},function(e){bad(note,e||"that did not go through.");});
  }
  /* queen, rook, bishop or knight — asked before the move is sent, because
     the server takes the piece as part of the move and not as a follow-up */
  function chessPromote(d,uci,note){
    var ov=el("div","chpromo");
    ["q","r","b","n"].forEach(function(k){
      var b=el("button","chpbtn "+(d.chess.youAre==="w"?"w":"b"));
      b.appendChild(pcEl(d.chess.youAre==="w"?k.toUpperCase():k));
      b.onclick=function(){if(ov.parentNode)ov.parentNode.removeChild(ov);chessMove(d,uci+k,note);};
      ov.appendChild(b);
    });
    var cancel=el("button","cbtn","cancel");
    cancel.onclick=function(){if(ov.parentNode)ov.parentNode.removeChild(ov);pitRender(PIT.last);};
    ov.appendChild(cancel);
    document.body.appendChild(ov);
  }
  function pitStop(){
    if(PIT.poll){clearInterval(PIT.poll);PIT.poll=null;WAKE=null;}
    if(PIT.tick){clearInterval(PIT.tick);PIT.tick=null;}
    /* a half-dealt cut must not keep turning cards over on a screen the player
       has already left */
    PIT.reveal.forEach(function(t){clearTimeout(t);});
    PIT.reveal=[];
    PIT.chips=null;
    /* leaving the table forgets which cards have already been dealt in, so
       coming back deals the hand in fresh rather than showing it half-landed */
    PIT.pkSeen=null;PIT.pkHand=null;PIT.pkAuto=false;PIT.pkAutoBusy=false;PIT.pkUp=null;PIT.pkUpAt=0;
    PIT.pkRaise=false;PIT.pkShow=false;PIT.pkAmt=0;PIT.pkKeys=null;PIT.chFrom=null;PIT.chDrag=null;PIT.chSent=false;PIT.chClocks=null;
    if(PIT.pkKeyBound){document.removeEventListener("keydown",PIT.pkKeyBound);PIT.pkKeyBound=null;}
    /* if a clash was mid-flight its callback will never land, so the render
       gate has to be lifted here or every later paint would be swallowed */
    PIT.busy=false;PIT.pending=null;
  }
  function pitAfter(ms,fn){
    var t=setTimeout(function(){
      PIT.reveal=PIT.reveal.filter(function(x){return x!==t;});
      fn();
    },ms);
    PIT.reveal.push(t);
    return t;
  }
  /* Turn one card over, in the slot it is already lying face down in. Replacing
     the node is what runs the animation — same mechanic blackjack uses to flip
     its hole card, and the same .pcard markup, so the two tables deal alike. */
  function cutTurn(slot,card){
    var c=cardEl(card);
    if(slot.firstChild)slot.replaceChild(c,slot.firstChild);
    else slot.appendChild(c);
  }
  /* the server ships its own clock with every duel, so the countdowns run off
     the server's deadline rather than a browser clock that may be minutes out */
  function pitSkew(d){if(d&&typeof d.now==="number")PIT.skew=d.now-Date.now();}
  function pitLeft(deadline){return Math.max(0,(Number(deadline)||0)-(Date.now()+PIT.skew));}
  function pitSecs(ms){return String(Math.ceil(ms/1000));}
  /* the confirm and move clocks are seconds; an open table runs for ten
     minutes, and "600s" is not something anybody reads as time */
  function pitClockText(ms){
    var t=Math.ceil(ms/1000);
    if(t<60)return t+"s";
    return Math.floor(t/60)+"m "+(t%60<10?"0":"")+(t%60)+"s";
  }
  function moveIcon(m){
    if(m==="tung"){var i=el("img","pmimg");i.src=(typeof TUNG_IMG!=="undefined")?TUNG_IMG:"";i.alt="tung";i.onerror=function(){i.style.display="none";};return i;}
    return el("span","pmemoji",m==="wood"?"🪵":"🔥");
  }
  function moveName(m){return m==="tung"?"tung":(m==="wood"?"wood":"fire");}

  /* ---- the poker table ----
     Everything here is the server's. The client paints what it was sent and
     sends back one of four words; it never decides a winner, a pot or whose
     turn it is, so editing any of it from devtools changes what you are
     looking at and nothing about the game. Hole cards it was not sent are
     drawn face down because they genuinely are not here. */
  function chips(n){
    n=Math.round(Number(n)||0);
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g,",");
  }
  /* A card that only performs its deal once.
     The table is rebuilt whenever it changes, which means every card is a new
     element on every action — and a new element replays the flip. So the whole
     board re-dealt itself each time somebody so much as checked. This keeps a
     note of what was in each slot and marks anything already seen as still, so
     only a card that genuinely just arrived turns over. The note is cleared
     when the hand number changes, which is exactly when the cards are new
     again. The key names the slot, so a hole card going from face down to
     face up at a showdown counts as new and flips, which is right.
     (Everything in this file lives inside one template literal, so there are
     no backticks here and there is no dollar-brace either.) */
  function pkWasSeen(key,c){return !!(PIT.pkSeen&&PIT.pkSeen[key]===c);}
  function pkCard(key,c,delay){
    var seen=pkWasSeen(key,c);
    var e=cardEl(c);
    if(seen)e.className+=" still";
    else if(delay>0){
      /* A flop is three cards, and three cards landing on the same frame is a
         row appearing rather than a flop being dealt. Each waits its turn.
         The deal animation is fill-mode both, so a card holds its first frame
         — face down and invisible — until its delay is up, which is what makes
         the wait read as the dealer's hand and not as a stutter. */
      var inner=e.querySelector(".pcinner");
      if(inner)inner.style.animationDelay=delay+"ms";
      var faces=e.querySelectorAll(".pcface");
      for(var fi=0;fi<faces.length;fi++)faces[fi].style.animationDelay=delay+"ms";
    }
    if(PIT.pkSeen)PIT.pkSeen[key]=c;
    return e;
  }
  function pokerTable(body,d,note){
    var p=d.poker;
    if(!p){body.appendChild(el("p","pitsub","dealing…"));return;}
    if(PIT.pkHand!==p.hand){PIT.pkHand=p.hand;PIT.pkSeen={};PIT.pkAuto=false;PIT.pkAmt=0;}
    /* the raise panel belongs to one decision; it cannot outlive your turn */
    if(!p.yourTurn){PIT.pkRaise=false;PIT.pkShow=false;}
    PIT.pkKeys=null;

    /* the blinds, and how long they stay these blinds */
    var head=el("div","pkhead");
    head.appendChild(el("span","pkblind",chips(p.blinds[0])+" / "+chips(p.blinds[1])));
    head.appendChild(el("span","pklvl","level "+p.level+" of "+p.levels));
    /* Kept as a live element rather than a rendered string. The table is only
       rebuilt when something about it changes, so a countdown drawn once sat
       frozen until somebody acted — it now runs off the same 200ms tick the
       big clock uses, corrected for how far this client's clock is from the
       server's. */
    if(p.nextLevel>0){
      var up=el("span","pkup","up in "+pitClockText(pitLeft(p.nextLevel)));
      head.appendChild(up);
      PIT.pkUp=up;PIT.pkUpAt=p.nextLevel;
    }else{PIT.pkUp=null;PIT.pkUpAt=0;}
    head.appendChild(el("span","pkhand","hand "+p.hand));
    /* ---- the table talk ----
       The same box Competitive Gambling has. It used to be a button in the
       header, and every button in this column is a wide one, so it came out
       as a long bar beside the hand number. It belongs in the corner of the
       screen: a round button, the log above it when it is open, and nothing
       in the column either way. The count sits on the button rather than in
       its label, or the circle stops being a circle the moment somebody talks. */
    var dock=el("div","pkdock");
    var tk=el("button","pktalkbtn");tk.type="button";tk.title="table talk";
    tk.appendChild(el("span","pktalkface","\uD83D\uDCAC"));
    tk.appendChild(el("span","pkbadge",""));
    var draw=el("div","pktalk");draw.style.display=TALK.open?"block":"none";
    if(TALK.open){draw.appendChild(talkBox());}
    tk.onclick=function(){
      TALK.open=!TALK.open;
      draw.style.display=TALK.open?"block":"none";
      if(TALK.open){
        draw.innerHTML="";draw.appendChild(talkBox());
        if(TALK.input)try{TALK.input.focus();}catch(e){}
      }else{draw.innerHTML="";TALK.log=null;TALK.input=null;}
      talkPaint();
    };
    dock.appendChild(draw);
    dock.appendChild(tk);
    PIT.pkTalkBtn=tk;
    talkPaint();
    body.appendChild(dock);

    /* ---- the table ----
       An oval of felt with the seats set around its rim, which is what a poker
       table looks like everywhere else and so needs no explaining. The seats
       are placed by angle rather than laid out in a row: the player looking at
       it is always at the bottom and everyone else is dealt round from there,
       so your own cards are in the same place every hand however many people
       are sitting and whichever chair you happen to be in. */
    var n=p.seats.length;
    var mine=p.yourSeat>=0?p.yourSeat:0;
    var stage=el("div","pkstage");
    var felt=el("div","pkfelt");
    stage.appendChild(felt);

    var mid=el("div","pkmid");
    /* The middle shows the pot as it stood when this street began, not the
       running total. What is going in right now is already on the screen —
       drawn in front of whoever pushed it out — so putting it in the middle as
       well is the same money twice, and a number that jumps on every call is
       not one anybody can read a decision off. It moves when the chips are
       actually swept in: after the flop, the turn, the river.
       The shortcut buttons below still count the whole pot, because a pot-sized
       raise means the pot as it will be, not as it was. p.pot is that number
       and is deliberately left alone. */
    mid.appendChild(el("div","pkpot",chips(typeof p.potMid==="number"?p.potMid:p.pot)));
    var board=el("div","pkboard");
    /* the stagger counts the cards ARRIVING, not their place on the board, so
       a turn or a river lands on its own beat instead of waiting out the gap
       for three cards that were already sitting there */
    var arriving=0;
    for(var bi=0;bi<5;bi++){
      if(bi<p.board.length){
        var already=pkWasSeen("b"+bi,p.board[bi]);
        board.appendChild(pkCard("b"+bi,p.board[bi],already?0:(arriving++)*150));
      }else board.appendChild(el("div","pcard pkslot"));
    }
    mid.appendChild(board);
    mid.appendChild(el("div","pkpotlab","pot"));
    stage.appendChild(mid);

    /* The ring the seats sit on. It is deliberately INSIDE the felt rather
       than outside it: a seat is about a fifth of the width, so one centred on
       the rim at the far left or right hangs half of itself off the screen on
       a phone. Sitting them just inside the edge keeps every plate on the
       table and still leaves the middle clear for the board. */
    /* The oval is flat and wide where there is room for it, and rounder where
       there is not: a phone column cannot carry a two-to-one table, because
       the board and the seat under it end up in the same forty pixels. So the
       shape follows the screen, and these follow the shape — the stylesheet
       switches the stage at the same width. */
    var wideTable=false;
    try{wideTable=(window.innerWidth||0)>=700;}catch(e){}
    var RX=wideTable?41:38, RY=30;
    p.seats.forEach(function(_,k){
      var i=(mine+k)%n;                 /* you first, then round the table */
      var s=p.seats[i];
      var a=(90+k*360/n)*Math.PI/180;   /* 90deg is the bottom of the screen */
      var cx=50+RX*Math.cos(a), cy=50+RY*Math.sin(a);
      var cls="pkseat";
      if(s.you)cls+=" you";
      if(s.out)cls+=" out";
      else if(s.folded)cls+=" folded";
      if(i===p.toAct&&!p.showing)cls+=" turn";
      var box=el("div",cls);
      box.style.left=cx.toFixed(2)+"%";
      box.style.top=cy.toFixed(2)+"%";

      var hole=el("div","pkhole");
      if(!s.out){
        if(s.cards&&s.cards.length){
          s.cards.forEach(function(c,ci){hole.appendChild(pkCard("s"+i+"c"+ci,c,ci*110));});
        }else{
          for(var h=0;h<(s.held||0);h++)hole.appendChild(pkCard("s"+i+"c"+h,"??",h*110));
        }
      }
      var plate=el("div","pkplate");
      var nm=el("div","pkname");
      nm.appendChild(el("span","pkwho",s.name));
      if(i===p.button)nm.appendChild(el("span","pkdealer","D"));
      plate.appendChild(nm);
      plate.appendChild(el("div","pkstack",s.out?"out":chips(s.chips)));
      if(!s.out&&s.allIn)plate.appendChild(el("div","pktag","all in"));
      else if(!s.out&&s.folded)plate.appendChild(el("div","pktag","folded"));
      /* your own hand, named, directly under your own cards */
      if(s.you&&p.yourHand&&!s.out&&!s.folded)hole.appendChild(el("div","pkmade",p.yourHand));
      /* Cards face into the table. Round the top of the oval the plate goes
         first and the cards hang below it; round the bottom it is the other
         way up. Either way the pair of cards is on the felt rather than
         sticking out over the rim into the room. */
      if(Math.sin(a)<-0.2){box.appendChild(plate);box.appendChild(hole);}
      else{box.appendChild(hole);box.appendChild(plate);}
      stage.appendChild(box);

      /* what they have pushed out this street, sitting between them and the
         pot the way chips actually do */
      if(!s.out&&s.inStreet>0){
        /* The two axes are squeezed by different things, so they are not the
           same fraction. Across, the chip has to thread the gap between the
           board and the seat beside it, which is barely wider than the chip.
           Up and down there is far more room, so it sits well clear of the
           seat above rather than tucking under that player's cards. */
        var bx=50+RX*0.65*Math.cos(a), by=50+RY*0.55*Math.sin(a);
        var chip=el("div","pkchip",chips(s.inStreet));
        chip.style.left=bx.toFixed(2)+"%";
        chip.style.top=by.toFixed(2)+"%";
        stage.appendChild(chip);
      }
    });
    /* the blinds sit on the felt, and the felt sits on the buttons. The spare
       height of a tall window stays above that group, so the three of them
       never drift apart. */
    var fit=el("div","pkfit");
    fit.appendChild(head);
    fit.appendChild(stage);
    body.appendChild(fit);

    /* what just happened, while it is still up */
    if(p.showing){
      body.appendChild(el("p","pitsay",p.note||""));
      if(p.show&&p.show.length){
        var sd=el("div","pkshow");
        p.show.forEach(function(x){
          var r=el("div","pkshowrow"+(x.won>0?" won":""));
          r.appendChild(el("span","pkshowname",x.name));
          var cc=el("span","pkshowcards");
          x.cards.forEach(function(c,ci){cc.appendChild(pkCard("sd"+x.name+ci,c));});
          r.appendChild(cc);
          r.appendChild(el("span","pkshowhand",x.hand+(x.won>0?" — takes "+chips(x.won):"")));
          sd.appendChild(r);
        });
        body.appendChild(sd);
      }
      body.appendChild(el("p","pitsub","next hand in a moment."));
    }else if(p.yourSeat<0||(p.seats[p.yourSeat]&&p.seats[p.yourSeat].out)){
      body.appendChild(el("p","pitsay","you are out."));
      body.appendChild(el("p","pitsub","the table plays on without you. the pot is settled when somebody has every chip."));
    }else if(p.yourTurn){
      /* a check/fold left standing from while you were waiting. It is spent
         the moment it is used, so it can never fold a hand three streets
         later that you meant to play. */
      if(PIT.pkAuto&&!PIT.pkAutoBusy){
        PIT.pkAuto=false;PIT.pkAutoBusy=true;
        pitSend("/duel/poker",{id:d.id,action:p.canCheck?"check":"fold",amount:0},function(){
          PIT.pkAutoBusy=false;
        }).then(function(){PIT.pkAutoBusy=false;});
      }
      var bb=p.blinds[1]||1;
      var send=function(scope,action,amount){
        Array.prototype.forEach.call(scope.querySelectorAll("button"),function(x){x.disabled=true;});
        pitSend("/duel/poker",{id:d.id,action:action,amount:amount||0},function(e){
          Array.prototype.forEach.call(scope.querySelectorAll("button"),function(x){x.disabled=false;});
          bad(note,e==="not your turn"?"somebody got there first.":(e||"that did not land."));
        });
      };
      var canRaise=p.maxTo>p.call;
      /* one row of decisions along the bottom, the order they are read in:
         what it costs to stay, what it costs to push, the free one, the way
         out. Each carries the key that presses it. */
      var act=function(label,key,kind,on,live){
        var b=el("button","pkact "+kind+(live?"":" off"));
        b.appendChild(el("span","pkactlab",label));
        b.appendChild(el("span","pkactkey",key));
        if(live)b.onclick=on; else b.disabled=true;
        return b;
      };
      if(!PIT.pkRaise){
        var bar=el("div","pkbar");
        bar.appendChild(act(p.canCheck?"CALL":("CALL "+chips(Math.min(p.toCall,p.maxTo))),"C","call",
          function(){send(bar,"call");},!p.canCheck));
        bar.appendChild(act("RAISE","R","raise",function(){
          PIT.pkRaise=true;PIT.pkShow=true;PIT.pkAmt=Math.max(p.raiseTo,Math.min(PIT.pkAmt||p.raiseTo,p.maxTo));
          PIT.shape="";pitRender(PIT.last);
        },canRaise));
        bar.appendChild(act("CHECK","K","check",function(){send(bar,"check");},p.canCheck));
        bar.appendChild(act("FOLD","F","fold",function(){send(bar,"fold");},true));
        body.appendChild(bar);
        body.appendChild(el("p","pitsub",p.toCall>0
          ?(chips(p.toCall)+" to call. say nothing and it folds.")
          :"say nothing and it checks."));
        PIT.pkKeys=function(ev){
          if(ev.target&&/^(INPUT|TEXTAREA)$/.test(ev.target.tagName))return;
          var k=String(ev.key||"").toLowerCase();
          if(k==="c"&&!p.canCheck)send(bar,"call");
          else if(k==="k"&&p.canCheck)send(bar,"check");
          else if(k==="f")send(bar,"fold");
          else if(k==="r"&&canRaise){PIT.pkRaise=true;PIT.pkShow=true;PIT.pkAmt=p.raiseTo;PIT.shape="";pitRender(PIT.last);}
          else return;
          ev.preventDefault();
        };
      }else{
        /* the raise panel, which takes the bar's place rather than sitting
           under it: while you are choosing a number the only things that make
           sense are the number, the shortcuts to it, and the way back. */
        var panel=el("div","pkbet");
        var clamp=function(n){
          n=Math.floor(Number(n));
          if(!isFinite(n))n=p.raiseTo;
          return Math.max(p.raiseTo,Math.min(n,p.maxTo));
        };
        PIT.pkAmt=clamp(PIT.pkAmt||p.raiseTo);
        var val=el("div","pkbetval");
        val.appendChild(el("span","pkbetlab","your bet"));
        var num=el("input","pkbetnum");num.type="number";num.min=String(p.raiseTo);num.max=String(p.maxTo);num.step="1";
        num.value=String(PIT.pkAmt);
        var bbs=el("span","pkbetbb","");
        val.appendChild(num);val.appendChild(bbs);
        var slide=el("input","pkslide");
        slide.type="range";slide.min=String(p.raiseTo);slide.max=String(p.maxTo);slide.step="1";
        /* the label on the confirm button is part of the amount: dragging to
           the top of your stack is an all-in and has to say so before it is
           pressed, not after */
        var betLab=null;
        var paint=function(){
          num.value=String(PIT.pkAmt);
          slide.value=String(PIT.pkAmt);
          bbs.textContent=(Math.round(PIT.pkAmt/bb*10)/10)+"BB";
          if(betLab)betLab.textContent=PIT.pkAmt>=p.maxTo?"ALL IN":"BET";
        };
        var setAmt=function(n){PIT.pkAmt=clamp(n);paint();};
        /* typing is left alone while it is happening — rewriting the box
           under the cursor makes it impossible to type a number that starts
           below the minimum — but everything else keeps up */
        num.oninput=function(){
          var n=Math.floor(Number(num.value));
          if(!isFinite(n))return;
          PIT.pkAmt=Math.max(p.raiseTo,Math.min(n,p.maxTo));
          slide.value=String(PIT.pkAmt);
          bbs.textContent=(Math.round(PIT.pkAmt/bb*10)/10)+"BB";
          if(betLab)betLab.textContent=PIT.pkAmt>=p.maxTo?"ALL IN":"BET";
        };
        num.onchange=function(){setAmt(num.value);};
        num.onblur=function(){setAmt(num.value);};
        slide.oninput=function(){setAmt(slide.value);};
        /* A pot-sized raise is the pot AFTER the call, put in on top of it —
           which is what every other table means by "pot", and is why the call
           is added twice rather than once. */
        var potRaise=function(frac){return clamp(p.call+Math.round(frac*(p.pot+p.toCall)));};
        var presets=el("div","pkpre-row");
        [["MIN",function(){return p.raiseTo;}],
         ["\u00bd POT",function(){return potRaise(0.5);}],
         ["\u00be POT",function(){return potRaise(0.75);}],
         ["POT",function(){return potRaise(1);}],
         ["ALL IN",function(){return p.maxTo;}]].forEach(function(row){
          var b=el("button","pkchipbtn",row[0]);
          b.onclick=function(){setAmt(row[1]());};
          presets.appendChild(b);
        });
        var srow=el("div","pkslidrow");
        var minus=el("button","pkstep","\u2212");
        minus.onclick=function(){setAmt(PIT.pkAmt-bb);};
        var plus=el("button","pkstep","+");
        plus.onclick=function(){setAmt(PIT.pkAmt+bb);};
        srow.appendChild(minus);srow.appendChild(slide);srow.appendChild(plus);
        var go=el("div","pkbetgo");
        var back=el("button","pkact fold");
        back.appendChild(el("span","pkactlab","BACK"));
        back.appendChild(el("span","pkactkey","esc"));
        back.onclick=function(){PIT.pkRaise=false;PIT.shape="";pitRender(PIT.last);};
        var bet=el("button","pkact bet");
        betLab=el("span","pkactlab","BET");
        bet.appendChild(betLab);
        bet.onclick=function(){
          var n=clamp(PIT.pkAmt);
          PIT.pkRaise=false;
          send(panel,n>=p.maxTo?"allin":"raise",n);
        };
        go.appendChild(back);go.appendChild(bet);
        /* What the minimum actually is, and why it is that and not double the
           last bet. A raise has to be at least the size of the last one, so
           the first bet on a street does make the minimum double it — but a
           re-raise over a small raise does not, and that reads as broken from
           the seat unless the table says so. The numbers are the ones this
           spot is using, not an example. */
        var minrow=el("div","pkminrow");
        minrow.appendChild(el("span","pkminlab","minimum raise"));
        minrow.appendChild(el("span","pkminval",chips(p.raiseTo)));
        var mhelp=el("span","pkhelp");
        mhelp.tabIndex=0;
        mhelp.setAttribute("role","button");
        mhelp.setAttribute("aria-label","why the minimum raise is what it is");
        mhelp.appendChild(el("span","pkhelpq","?"));
        mhelp.appendChild(el("span","pkhelptip",
          "a raise has to be at least as big as the last one. the last raise here "+
          "was "+chips(p.minRaise)+", so you have to put at least that much on top of the "+
          chips(p.call)+" already out \u2014 "+chips(p.raiseTo)+" in total. that is only double "+
          "the bet when nobody had bet before it."));
        minrow.appendChild(mhelp);
        panel.appendChild(val);panel.appendChild(minrow);
        panel.appendChild(presets);panel.appendChild(srow);panel.appendChild(go);
        body.appendChild(panel);
        paint();
        /* The point of this panel is the button that ends it, and the table
           above it is tall enough that on a laptop window the panel can open
           with BET under the fold \u2014 which turns confirming a raise into a
           scroll hunt while a clock is running. The desktop layout is short
           enough that it usually fits; this is what makes "usually" into
           "always", and only on the press that opened it, so a repaint while a
           number is being chosen never yanks the page about. block:"nearest"
           scrolls the least it can, so on a window where it already fits
           nothing moves at all. */
        if(PIT.pkShow){
          PIT.pkShow=false;
          try{go.scrollIntoView({block:"nearest"});}
          catch(e){try{go.scrollIntoView(false);}catch(e2){}}
        }
        PIT.pkKeys=function(ev){
          if(ev.target&&/^(INPUT|TEXTAREA)$/.test(ev.target.tagName))return;
          var k=String(ev.key||"");
          if(k==="Escape"){PIT.pkRaise=false;PIT.shape="";pitRender(PIT.last);}
          else if(k==="Enter")bet.onclick();
          else return;
          ev.preventDefault();
        };
      }
    }else{
      var w=p.seats[p.toAct];
      body.appendChild(el("p","pitsub",p.runout
        ?"all in. running the board out."
        :("waiting on "+(w?w.name:"the table")+".")));
      /* The decision you can make before it is your turn. Only offered while
         you are actually waiting on somebody — once it IS your turn the real
         buttons are right there and this would be a second way to press them. */
      var ms=p.yourSeat>=0?p.seats[p.yourSeat]:null;
      if(ms&&!ms.out&&!ms.folded&&!ms.allIn&&!p.showing&&!p.runout&&p.toAct>=0){
        /* A tick box, not a button: it does not DO anything when it is pressed,
           it sets what will happen later — and a button sitting where FOLD
           sits, reading "check / fold", is one you can hit meaning to fold now.
           Wrapped in a label so the words toggle it too. */
        var pre=el("label","pkprebox"+(PIT.pkAuto?" on":""));
        var cb=document.createElement("input");
        cb.type="checkbox";cb.className="pkprecb";cb.checked=!!PIT.pkAuto;
        cb.onchange=function(){
          PIT.pkAuto=!!cb.checked;
          /* repainted in place: re-rendering the table would rebuild it under
             the finger that just tapped this */
          pre.className="pkprebox"+(cb.checked?" on":"");
        };
        pre.appendChild(cb);
        pre.appendChild(el("span","pkprelab","check / fold"));
        var prerow=el("div","pkprerow");
        prerow.appendChild(pre);
        /* The explanation lives behind a mark rather than in a line under the
           box, because it is only ever read once: somebody who knows what a
           pre-action is does not need a sentence about it under every hand.
           Focusable as well as hoverable, or it would say nothing at all on a
           phone, where there is no hover to do it with. */
        var help=el("span","pkhelp");
        help.tabIndex=0;
        help.setAttribute("role","button");
        help.setAttribute("aria-label","what check / fold does");
        help.appendChild(el("span","pkhelpq","?"));
        help.appendChild(el("span","pkhelptip",
          "decide now, and it happens the moment the action reaches you: "+
          "you check if nobody has bet, and fold if somebody has. "+
          "it is used once and then clears, so it cannot fold a hand later that you meant to play."));
        prerow.appendChild(help);
        body.appendChild(prerow);
      }
    }

    /* Shortcuts, rebound on every paint because what the keys DO changes with
       the table — and unbound the moment the table is not asking for anything,
       so a stray keypress on the lobby cannot fold a hand. */
    if(PIT.pkKeyBound){document.removeEventListener("keydown",PIT.pkKeyBound);PIT.pkKeyBound=null;}
    if(PIT.pkKeys){PIT.pkKeyBound=PIT.pkKeys;document.addEventListener("keydown",PIT.pkKeyBound);}
  }

  /* ---- the pit lobby: who is waiting, and a form to wait yourself ---- */
  function viewPit(game){
    var cfg=PIT_GAMES[game]||PIT_GAMES.tung;
    var v=mount(cfg.name,gameIcon("pit-"+game));VIEW="pit";paintRound();PIT.game=game;PIT.id=null;PIT.shape="";
    PIT.roundsSeen=null;PIT.busy=false;PIT.pending=null;
    v.appendChild(el("p","pitblurb",cfg.blurb));
    v.appendChild(el("p","pitsub",cfg.sub));

    var bet=betField("1");
    /* The two games that wait for a fixed number. Tung, Wood, Fire is a hand
       against ONE opponent, so it never offers the choice — and poker no
       longer does either: its table opens with all five chairs, anybody may
       take one, and the host deals when they are ready. Naming the number in
       advance was a guess either way round: guess high and a table nobody else
       found sat there for ten minutes and refunded itself; guess low and the
       fourth person to turn up could not sit down. */
    var seatsSel=(game==="cut"||game==="comp")
      ?selectOf([["2","2"],["3","3"],["4","4"]],"2")
      :null;
    /* chess is the one table that can be played for nothing, so it gets the
       choice, and the stake box is only worth showing once there is a stake */
    var freeSel=game==="chess"?selectOf([["0","free \u2014 nothing on it"],["1","for sahurs"]],"0"):null;
    /* the clock. Each player gets their own, it runs only while it is their
       move, and the id here is what the server keys CHESS_TC on \u2014 keep the
       left-hand column in step with that table (scripts/test-chess.ts checks). */
    var tcSel=game==="chess"?selectOf([
      ["3+0","3 min"],["3+2","3 | 2"],["5+0","5 min"],
      ["10+0","10 min"],["15+0","15 min"],["60+0","1 hour"]
    ],"10+0"):null;
    /* which set the pieces are drawn with. Remembered, and it takes effect on
       the board the moment it is changed rather than on the next game. */
    var pieceSel=null;
    if(game==="chess"&&typeof PIECE_THEMES!=="undefined"){
      pcProbe();
      pieceSel=selectOf(PIECE_THEMES.map(function(t){
        return [t,t.replace(/_/g," ")];
      }),pcTheme());
      pieceSel.addEventListener("change",function(){pcSetTheme(pieceSel.value);});
    }
    var open=el("button","cbtn go","put up a table");
    var row=el("div","ctlrow");
    if(tcSel)row.appendChild(ctl("clock",tcSel));
    if(freeSel)row.appendChild(ctl("playing for",freeSel));
    if(pieceSel)row.appendChild(ctl("pieces",pieceSel));
    var betCtl=ctl("stake",bet);
    row.appendChild(betCtl);
    if(freeSel){
      var syncFree=function(){betCtl.style.display=freeSel.value==="0"?"none":"";};
      freeSel.addEventListener("change",syncFree);syncFree();
    }
    if(seatsSel)row.appendChild(ctl("players",seatsSel));
    var bw=el("div","casrow");bw.appendChild(open);
    row.appendChild(ctl(" ",bw));
    v.appendChild(row);
    var r=res(v);
    v.appendChild(el("div","seclabel","open tables"));
    var list=el("div","pitlist");v.appendChild(list);
    v.appendChild(el("div","casnote",game==="cut"
      ?"your stake is held the moment you sit down, and comes straight back if the table is cancelled, it does not fill within 10 minutes, or anyone does not confirm."
      :(game==="comp"
        ?"your stake is held the moment you sit down, and comes straight back if the table is cancelled, it does not fill within 10 minutes, or anyone does not confirm. the wood inside the round is worth nothing outside it \u2014 the stakes are the only sahurs on the table."
        :(game==="poker"
          ?"your stake is held the moment you sit down, and comes straight back if the table is cancelled, it does not fill within 10 minutes, or anyone does not confirm. once it deals, it is played out \u2014 the buy-ins go to whoever ends up with every chip."
          :"your stake is held the moment you sit down, and comes straight back if the table is cancelled, nobody joins within 10 minutes, or either of you does not confirm."))));

    open.onclick=function(){
      open.disabled=true;r.className="casres";r.textContent="";
      var body={game:game,bet:(freeSel&&freeSel.value==="0")?0:Number(bet.value)};
      if(seatsSel)body.seats=Number(seatsSel.value);
      if(tcSel)body.tc=tcSel.value;
      jpost("/duel/create",body).then(function(d){if(refused(d)){refusedGate();return;}
        open.disabled=false;
        if(!d||d.error){bad(r,d&&d.error==="already in a duel"?"you are already at a table.":(d&&d.error)||"could not open a table");return;}
        setBal(d.balance);pitRefresh();
      }).catch(function(){open.disabled=false;bad(r,"network error");});
    };

    function paintList(d){
      /* a table of your own is never in this list: you are taken to its page */
      var rows=(d.open||[]).filter(function(t){return t.game===game&&!t.mine;});
      list.innerHTML="";
      if(!rows.length){
        list.appendChild(el("div","casnote","nobody is waiting. put a table up and someone will find it."));
        return;
      }
      rows.forEach(function(t){
        var box=el("div","pitrow"+(t.mine?" mine":""));
        var g=el("div","grow");
        g.appendChild(el("h4",null,t.mine?"your table":t.host));
        var lf=pitLeft(t.deadline);
        var seats=t.seats||2, filled=t.filled||1;
        /* A table the host closes is not waiting for a number, so quoting one
           would send people away from a game that is about to start: "1 / 5"
           reads as four people short when it is really one press from dealing
           heads-up. */
        var wait=(t.hostStarts
          ?(filled+" at the table, room for "+seats+" — the host deals when ready")
          :(seats>2?(filled+" / "+seats+" seated"):(t.mine?"waiting for someone":"waiting")))
          +" — "+pitClockText(lf)+" left";
        /* what you are actually sitting down to. Worth saying before you do:
           three minutes and an hour are not the same game. */
        if(t.tcName)wait=t.tcName+" — "+wait;
        g.appendChild(el("p",null,wait));
        box.appendChild(g);
        box.appendChild(el("div","price",money(t.bet)+" sahurs"));
        var sit=el("button","cbtn go","sit down");
        sit.onclick=function(){
          sit.disabled=true;
          jpost("/duel/join",{id:t.id}).then(function(rr){if(refused(rr)){refusedGate();return;}
            sit.disabled=false;
            if(!rr||rr.error){bad(r,rr.error==="taken"?"somebody beat you to it.":(rr.error==="insufficient"?"not enough sahurs for that stake.":(rr.error==="already in a duel"?"you are already at a table.":"could not sit down")));pitRefresh();return;}
            setBal(rr.balance);pitEnter(rr.duel);
          }).catch(function(){sit.disabled=false;bad(r,"network error");});
        };
        box.appendChild(sit);
        list.appendChild(box);
      });
    }

    function pitRefresh(){
      if(napping())return;
      jget("/duel/list?token="+encodeURIComponent(tok())).then(function(d){
        if(refused(d)){refusedGate();return;}
        if(!d||d.error)return;
        pitSkew(d);setBal(d.balance);
        /* your own table takes you to its own page, waiting or not */
        if(d.mine){pitEnter(d.mine);return;}
        paintList(d);
      }).catch(function(){});
    }
    pitStop();pitRefresh();
    /* brisk, because a table of yours being joined starts a ten second clock */
    PIT.poll=setInterval(pitRefresh,1500);onWake(pitRefresh);
  }

  /* ---- one duel, from the handshake to the result ---- */
  function pitEnter(view){
    pitStop();
    PIT.id=view.id;PIT.game=view.game||PIT.game;PIT.shape="";PIT.roundsSeen=null;PIT.pending=null;
    pitRender(view);
    var pitOne=function(){
      if(napping())return;
      jget("/duel/state?token="+encodeURIComponent(tok())+"&id="+encodeURIComponent(PIT.id)+"&talk="+TALK.n).then(function(d){
        if(refused(d)){refusedGate();return;}
        if(!d||d.error){if(d&&d.error==="gone"){pitStop();openPlay("pit-"+(PIT.game||"tung"));}return;}
        pitSkew(d);setBal(d.balance);talkSync(d.talk,d.talkN);pitRender(d.duel);
      }).catch(function(){});
    };
    PIT.poll=setInterval(pitOne,1200);onWake(pitOne);
  }

  function pitSend(path,body,onErr){
    return jpost(path,body).then(function(d){if(refused(d)){refusedGate();return null;}
      if(!d||d.error){if(onErr)onErr(d&&d.error);if(d&&d.duel){pitSkew(d);pitRender(d.duel);}return null;}
      pitSkew(d);setBal(d.balance);pitRender(d.duel);return d;
    }).catch(function(){if(onErr)onErr("network");return null;});
  }

  /* The screen is rebuilt only when the duel changes shape — state, round, what
     you have already done. Everything else is a countdown, and redrawing the
     page under a running clock makes buttons impossible to hit. */
  function pitRender(d){
    PIT.last=d;
    /* which table the talk box belongs to, if this one has a box at all. Named
       here rather than in pokerTable() so that leaving a table clears it too —
       a conversation belongs to one table and nothing of it may follow you to
       the next. */
    talkFor((d.game==="poker"||d.game==="comp")&&d.state==="live"?d.id:null,d.you);
    /* the bar belongs to the rest of the casino, but this page is the same
       round: keep it fed here too, and stand it down once the round is read */
    if(d.game==="comp"&&d.state==="live")roundSync(d);
    else if(ROUND.live&&ROUND.live.id===d.id)roundStop();
    /* a clash owns the screen while it plays; the newest state waits for it */
    if(PIT.busy){PIT.pending=d;return;}
    /* So does a piece in hand. The board is rebuilt from scratch on every
       render and the duel is polled about once a second, so without this the
       poll yanks the element the pointer was captured on out from under a drag
       and the drop lands on nothing. The next poll redraws it a moment later. */
    if(PIT.chDrag||PIT.chSent)return;
    /* first sight of a duel establishes the baseline, so reopening one that is
       already several rounds in does not replay them all */
    if(PIT.roundsSeen===null){PIT.roundsSeen=(d.rounds&&d.rounds.length)||0;}
    else if(d.rounds&&d.rounds.length>PIT.roundsSeen&&(PIT_GAMES[d.game]||{}).moves&&(PIT_GAMES[d.game]||{}).moves.length){
      PIT.roundsSeen=d.rounds.length;
      pitClash(d,d.rounds[d.rounds.length-1],function(){
        PIT.busy=false;
        var nxt=PIT.pending||d;PIT.pending=null;
        PIT.shape="";                       /* the clash replaced the screen */
        pitRender(nxt);
      });
      return;
    }
    var cfg=PIT_GAMES[d.game]||PIT_GAMES.tung;
    var who=(d.players||[]).map(function(p){return p.name+":"+(p.confirmed?"1":"0")+(p.bot?":t":"");}).join(",");
    /* A poker table changes under every one of those keys and none of them:
       same state, same round, same everybody — and a different pot, board and
       player to act. So it carries its own fingerprint, covering exactly what
       is drawn. The act clock is deliberately NOT in it: a countdown must not
       rebuild the screen, or the buttons move out from under the hand reaching
       for them, which is the whole reason this gate exists. */
    var pk=d.poker;
    var pkShape=pk?[pk.hand,pk.street,pk.toAct,pk.pot,pk.potMid,pk.call,pk.level,pk.showing?1:0,
      (pk.board||[]).join(""),(pk.yourCards||[]).join(""),
      (pk.seats||[]).map(function(s){
        return s.chips+"."+s.inStreet+"."+(s.folded?1:0)+(s.allIn?1:0)+(s.out?1:0)+"."+(s.cards||[]).join("");
      }).join(",")].join("~"):"";
    /* the position, whose move it is and what has been offered \u2014 the clock
       is left out on purpose, the same as poker's: a countdown must not rebuild
       the board out from under the hand reaching for a piece */
    var ch=d.chess;
    var chShape=ch?[ch.fen,ch.result,ch.reason,ch.drawFrom,ch.yourTurn?1:0,PIT.chFrom||"",PIT.chDrag||""].join("~"):"";
    /* everything the SCREEN is made of, with the chess position deliberately
       left out of it — see the fast path below */
    var frame=[d.state,d.round,d.yourMove,d.youConfirmed,d.theyConfirmed,d.theyMoved,d.winner,(d.paid||[]).length,d.reason,d.guest,d.filled,d.canCall,d.tung,d.tungs,who,pkShape].join("|");
    var shape=frame+"|"+chShape;
    if(shape===PIT.shape){pitPaintClock();return;}
    /* ---- a move is not a new screen ----
       Everything else here answers a change by rebuilding the view from the top
       down, which for chess meant the whole page — back button, header, names,
       pot, clock, board and panel — coming down and going back up every time
       the other person moved. That is the flash: not the position changing, the
       screen being replaced in order to change it. So when the ONLY thing that
       differs is the position, the board already on the screen is repainted in
       place and the rest of the page is never touched.
       PIT.shape being empty is how the rest of this file asks for a real
       rebuild (a piece set changing under it, a refused move), so an empty one
       never takes this path. */
    if(ch&&d.game==="chess"&&d.state==="live"&&PIT.shape&&frame===PIT.frame
      &&PIT.chUI&&PIT.chUI.id===d.id&&PIT.chUI.board&&PIT.chUI.board.isConnected){
      PIT.shape=shape;
      chessPaint(d,PIT.chUI.note);
      return;
    }
    PIT.shape=shape;PIT.frame=frame;
    if(PIT.tick){clearInterval(PIT.tick);PIT.tick=null;}
    var v=mount(cfg.name,gameIcon("pit-"+d.game));VIEW="pit";paintRound();
    /* a live poker table is one screen: the felt, the buttons, and no log
       under them. The class is what lets the stylesheet size the oval to
       whatever height is actually left. */
    if(d.game==="poker"&&d.state==="live")screen.classList.add("pkpage");
    var back=v.parentNode.querySelector(".casback");
    /* mid-round the casino floor IS the game, so the way out of THIS page is
       the floor rather than the pit's own list of tables. Given to paintBack()
       rather than set on the button, so that a round running underneath does
       not relabel a page that is already the round's own. */
    paintBack(back,(d.game==="comp"&&d.state==="live")
      ?function(){clearTimer();window.__casinoOpen();}
      :function(){pitStop();viewPit(d.game);});

    /* A live poker table already has everybody's name on it, in their chair,
       with their stack under it \u2014 so a row of names above it is the same
       information twice and costs the table a chunk of the screen it needs.
       Every other game keeps it: two names either side of a "vs" IS the
       matchup there. */
    if(!(d.game==="poker"&&d.state==="live")){
      var head=el("div","pitvs");
      var names=(d.players&&d.players.length)?d.players.slice():[{name:d.you||"you",you:true},{name:d.theirName||"\u2026"}];
      var seats=d.seats||2;
      while(names.length<seats)names.push({name:"\u2026"});
      names.forEach(function(p,i){
        if(i)head.appendChild(el("span","pvs","vs"));
        var n=el("span","pn"+(p.bot?" tung":""),p.you?(d.you||"you"):(p.name||"\u2026"));
        head.appendChild(n);
      });
      v.appendChild(head);
    }
    /* "0.00 sahurs on the table" is a true sentence and a silly one; a table
       with nothing on it should say so in words */
    v.appendChild(el("div","pitpot",(Number(d.pot)>0
      ?money(d.pot)+" sahurs on the table"
      :"nothing on the table \u2014 a friendly game")+(d.tung?" \u2014 tung's table":"")));

    var clock=el("div","pitclock","");v.appendChild(clock);
    PIT.left=clock;
    var body=el("div","pitbody");v.appendChild(body);
    var note=el("div","casres","");v.appendChild(note);

    if(d.state==="open"){
      /* The table page while it is still filling. A 2-seat table only lives
         here with the host alone; a 3- or 4-seat Cut stays here until the
         last chair is taken. This is the only page that can take it down. */
      var filled=d.filled||1, seatsN=(d.seats||2), need=Math.max(0,seatsN-filled);
      var onFull=d.game==="comp"
        ? "the round starts once the table is full and everyone says yes."
        : "the deck is cut once the table is full and everyone says yes.";
      if(d.youAreHost){
        /* A table that waits for a DECISION reads nothing like one waiting for
           a chair. There is no number outstanding and nothing to be waiting
           for: there is a table with people at it and a host who has not dealt
           yet. Saying "waiting for three more" under a five-chair poker table
           with two people at it is the old model still talking. */
        if(d.hostStarts){
          body.appendChild(el("p","pitsay",filled<=1
            ?"your table is up."
            :(filled+" at the table \u2014 deal when you like.")));
          body.appendChild(el("p","pitsub",filled<=1
            ?("nobody has sat down yet. anybody can, up to "+seatsN+" \u2014 and you deal when you are ready, so you are not waiting for a full table.")
            :("room for "+seatsN+" in all. deal now, or leave it up and see who else turns up.")));
          var go=el("button","cbtn go",filled<=1
            ?"nobody to deal to yet"
            :("deal \u2014 "+filled+" playing"));
          go.disabled=!d.canStart;
          go.onclick=function(){
            if(!d.canStart)return;
            go.disabled=true;
            jpost("/duel/start",{id:d.id}).then(function(rr){if(refused(rr)){refusedGate();return;}
              go.disabled=false;
              if(!rr||rr.error){
                bad(note,rr&&rr.error==="nobody has sat down yet"
                  ?"nobody is at the table yet."
                  :((rr&&rr.error)||"could not deal."));
                if(rr&&rr.duel){pitSkew(rr.duel);pitRender(rr.duel);}
                return;
              }
              pitSkew(rr.duel);pitRender(rr.duel);
            }).catch(function(){go.disabled=false;bad(note,"network error");});
          };
          body.appendChild(go);
        }else{
          body.appendChild(el("p","pitsay",filled<=1?"your table is up.":(filled+" of "+seatsN+" seated.")));
          body.appendChild(el("p","pitsub",need===0
            ?"the table is full."
            :(need===1
              ?(filled<=1?"waiting for somebody to sit down. nobody has yet, so you can take it back."
                :"waiting for one more. you can still take it down.")
              :"waiting for "+need+" more. you can still take it down.")));
        }
        var kill=el("button","cbtn stop","take it down \u2014 "+money(d.bet)+" sahurs back");
        kill.onclick=function(){
          kill.disabled=true;
          jpost("/duel/cancel",{id:d.id}).then(function(rr){if(refused(rr)){refusedGate();return;}
            kill.disabled=false;
            if(!rr||rr.error){
              /* somebody sat down in the moment between painting and clicking */
              bad(note,rr&&rr.error==="someone is at the table"?"too late — somebody just sat down.":"could not take it down.");
              return;
            }
            setBal(rr.balance);
            pitStop();viewPit(d.game);
          }).catch(function(){kill.disabled=false;bad(note,"network error");});
        };
        body.appendChild(kill);
        if(d.canCall){
          /* nobody about, or nobody you want to wait for. tung cuts a card like
             anyone else — but he is the house, so the table says so. */
          var call=el("button","cbtn go","call tung");
          call.onclick=function(){
            call.disabled=true;
            jpost("/duel/call",{id:d.id}).then(function(rr){if(refused(rr)){refusedGate();return;}
              call.disabled=false;
              if(!rr||rr.error){bad(note,rr&&rr.error==="taken"?"too late — somebody just sat down.":((rr&&rr.error)||"he did not come."));return;}
              if(typeof rr.balance==="number")setBal(rr.balance);
              pitSkew(rr.duel);pitRender(rr.duel);
            }).catch(function(){call.disabled=false;bad(note,"network error");});
          };
          body.appendChild(call);
        }
        body.appendChild(el("p","pitsub",filled<=1
          ?"if nobody comes, it closes itself and the stake comes back either way."
          :"taking it down sends every stake home. if it never fills, the same thing happens on its own."));
      }else{
        body.appendChild(el("p","pitsay","you are seated."));
        if(d.hostStarts){
          body.appendChild(el("p","pitsub",filled+" at the table so far, room for "+seatsN+". the host deals when they are ready \u2014 it does not have to fill up first. then everyone says yes and the first hand goes out."));
          body.appendChild(el("p","pitsub","your stake is held. it comes back if the host takes the table down, or if it is never dealt."));
        }else{
          body.appendChild(el("p","pitsub",(need===1?"waiting for one more. ":"waiting for "+need+" more. ")+onFull));
          body.appendChild(el("p","pitsub","your stake is held. it comes back if the host takes the table down or the table never fills."));
        }
      }
    }else if(d.state==="confirm"){
      var ready=(d.players||[]).filter(function(p){return p.confirmed;}).length;
      /* the people at the table, not the chairs it has: a poker table dealt
         three-handed has five chairs and three players, and it is the three
         that everything here is about */
      var total=(d.players&&d.players.length)||d.filled||(d.seats||2);
      var many=total>2;
      body.appendChild(el("p","pitsay",d.youConfirmed
        ?(many?"you are in. waiting on the others.":"you are in. waiting on them.")
        :(d.hostStarts?"the table is set. say yes before the clock runs out."
          :(many?"the table is full. say yes before the clock runs out.":"they are waiting. say yes before the clock runs out."))));
      body.appendChild(el("p","pitsub",many
        ?(ready+" of "+total+" have confirmed.")
        :(d.theyConfirmed?"they have confirmed.":"they have not confirmed yet.")));
      if(!d.youConfirmed){
        var yes=el("button","cbtn go","i'm in");
        yes.onclick=function(){yes.disabled=true;pitSend("/duel/confirm",{id:d.id},function(){yes.disabled=false;bad(note,"too late.");});};
        body.appendChild(yes);
      }
      if(d.game==="comp"){
        body.appendChild(el("p","pitsub","say yes and everyone at the table is handed "+money(d.stack)+" wood and three minutes to do something with it. the biggest pile at the buzzer takes the pot; level at the top and it is split."));
      }
      if(d.game==="poker"){
        body.appendChild(el("p","pitsub","say yes and everyone is dealt a stack and the first hand goes out. it runs until one of you has every chip — the blinds climb the whole way, so that will happen."));
      }
      body.appendChild(el("p","pitsub",many
        ?"if anyone does not confirm, every stake comes straight back."
        :"if either of you does not confirm, both stakes come straight back."));
    }else if(d.state==="live"&&d.game==="comp"){
      /* the scoreboard is both stacks, and they are both public: watching
         theirs move is the game as much as moving your own is. */
      body.appendChild(compScore(d,false));
      body.appendChild(el("p","pitsub","wood. not sahurs, and never sahurs \u2014 it is swept when the clock stops. the pot is what is actually on the table."));
      /* the table's own page shows the talk open; out on the floor it is a
         drawer under the round bar. never both, so one box is enough. */
      body.appendChild(el("div","seclabel","table talk"));
      body.appendChild(talkBox());
      body.appendChild(el("p","pitsub","just for the three minutes, and just for this table. it goes when the round does \u2014 nothing said here is kept."));
      body.appendChild(floorMenu("comp"));
      body.appendChild(el("p","pitsub","the whole floor, and the round follows you onto whatever you pick. a hand still open when the clock stops is a stake you paid and never played, so finish what you start \u2014 and while one is still open you are not out, however empty the stack reads."+
        (many2(d)?" run the wood out here and you are done, but the round plays on while two of you still have something.":"")));
    }else if(d.state==="live"&&d.game==="chess"){
      chessBoard(body,d,note);
    }else if(d.state==="live"&&d.game==="poker"){
      pokerTable(body,d,note);
    }else if(d.state==="live"){
      var score=el("div","pitscore");
      score.appendChild(el("span","sv",String(d.yourWins)));
      score.appendChild(el("span","sl","round "+d.round+" — first to "+d.target));
      score.appendChild(el("span","sv",String(d.theirWins)));
      body.appendChild(score);
      if(d.yourMove){
        var picked=el("div","pitpicked");
        picked.appendChild(el("span","pl","you played"));
        picked.appendChild(moveIcon(d.yourMove));
        picked.appendChild(el("span","pl",d.theyMoved?"they have played too":"waiting on them"));
        body.appendChild(picked);
      }else{
        var pickRow=el("div","pitmoves");
        cfg.moves.forEach(function(m){
          var b=el("button","pitmove");
          b.appendChild(moveIcon(m));
          b.appendChild(el("span",null,moveName(m)));
          b.onclick=function(){
            Array.prototype.forEach.call(pickRow.querySelectorAll("button"),function(x){x.disabled=true;});
            pitSend("/duel/move",{id:d.id,move:m},function(e){
              Array.prototype.forEach.call(pickRow.querySelectorAll("button"),function(x){x.disabled=false;});
              bad(note,e==="already played"?"you already played this round.":"that did not land.");
            });
          };
          pickRow.appendChild(b);
        });
        body.appendChild(pickRow);
        body.appendChild(el("p","pitsub","they cannot see your pick, and you cannot see theirs. play before the clock runs out or you forfeit."));
      }
      pitHistory(body,d);
    }else if(d.state==="done"){
      /* stop the poll and the clock BEFORE the cut starts dealing, so the
         reveal timers registered below are not cleared by our own cleanup */
      pitStop();
      /* the paid list is who took from the pot: nobody (every stake went home), one
         player (an outright win), or several (a dead heat sharing it out).
         What it MEANS for this player is the number, not the name — a full
         dead heat pays a share that is exactly the stake back, which is not a
         win and must not be painted as one. */
      var paid=d.paid||[];
      var take=Number(d.yourTake)||0;
      var won=paid.some(function(x){return x.name===d.you;});
      var split=paid.length>1;
      var up=take>d.bet+1e-9, down=paid.length>0&&take<d.bet-1e-9;
      var big=el("div","pitend"+(up?" win":(down?" lose":"")));
      var dealing=false,cutSay=null,cutHands=[];
      if(d.reason==="play"&&(d.hands||d.cards)){
        dealing=true;
        cutHands=(d.hands&&d.hands.length)?d.hands.slice():[
          {name:"you",card:d.youAreHost?d.cards.host:d.cards.guest,you:true},
          {name:d.theirName||"them",card:d.youAreHost?d.cards.guest:d.cards.host,you:false}
        ];
        cutHands.sort(function(a,b){return (b.you?1:0)-(a.you?1:0);});
        var cards=el("div","pitcards");
        cutHands.forEach(function(h){
          var box=el("div","pcut");
          box.appendChild(el("b",null,h.you?"you":(h.name||"them")));
          h.slot=el("div","cutslot");
          h.slot.appendChild(cardEl("??"));
          box.appendChild(h.slot);
          cards.appendChild(box);
        });
        /* every card face down first, so the row is its final size from the
           start and nothing jumps as they turn */
        body.appendChild(cards);
        cutSay=el("div","clashsay cut","");body.appendChild(cutSay);
      }
      var many=(d.filled||(d.players&&d.players.length)||(d.seats||2))>2;
      /* a round that was actually played is read off its stacks; the pit's
         other exits (never joined, never confirmed) still read as themselves */
      var ranOut=d.reason==="bust";
      var buzzer=d.game==="comp"&&(ranOut||d.reason==="clock"||d.reason==="draw");
      if(buzzer){
        body.appendChild(compScore(d,true));
        var seated=(d.players&&d.players.length)||d.filled||d.seats||2;
        var pile=many?"biggest pile":"bigger pile";
        big.textContent=!paid.length
          ?"nobody is left holding anything. every stake is back."
          :(split
            ?(paid.length>=seated
              /* everyone level: a share each, which at equal stakes is the
                 stake itself — say so rather than calling it a win */
              ?(many?"a dead heat. nothing between any of you, so the pot is split "+paid.length+" ways and every stake comes home."
                    :"a dead heat. neither of you is ahead, so both stakes are back.")
              :"a dead heat at the top. "+nameList(paid,d.you)+" finish level and split the pot"+
                (won?" \u2014 "+money(take)+" sahurs to you.":"."))
            :(won
              ?(ranOut?(many?"everyone else ran the wood out. the pot is yours.":"they ran the wood out. the pot is yours.")
                      :"you finish on the "+pile+". you take the pot.")
              :(ranOut&&chipsOf({chips:d.yourChips})<=0
                ?"you ran the wood out. the pot went to "+d.winner+"."
                :d.winner+" finishes on the "+pile+" and takes the pot.")));
      }else big.textContent=!paid.length
        ?(d.reason==="cancelled"?"table taken down. your stake is back."
          :d.reason==="expired"?(many?"the table never filled. your stake is back.":"nobody came. your stake is back.")
          :d.reason==="unconfirmed"?(many?"someone never confirmed. every stake is back.":"one of you never confirmed. both stakes are back.")
          :"nobody played. both stakes are back.")
        :(won?(d.reason==="forfeit"?"they never played. the pot is yours.":"you take the pot.")
              :(d.reason==="forfeit"?"you did not play in time. the pot went to them.":d.winner+" takes the pot."));
      body.appendChild(big);
      pitHistory(body,d);
      var again=el("button","cbtn go","back to the pit");
      again.onclick=function(){pitStop();viewPit(d.game);};
      body.appendChild(again);
      /* what a win actually multiplied the stake by is how many people were AT
         the table, which is no longer the same as how many chairs it had */
      var potx=d.filled||(d.players&&d.players.length)||d.seats||2;
      if(!dealing){
        /* a share of a split is what landed in the balance, so it is what the
           toast says — quoting the whole pot would be a lie on a tie */
        if(up)celebrate(take,potx);
      }else{
        /* the result would give the last card away, so it waits behind it */
        big.style.visibility="hidden";
        again.style.visibility="hidden";
        function cutTell(t){if(!cutSay)return;cutSay.textContent=t;cutSay.className="clashsay cut show";}
        cutTell("the deck is cut.");
        var mineH=cutHands[0], rest=cutHands.slice(1);
        /* yours: it stirs, then turns */
        pitAfter(CUT_STIR_MS,function(){if(mineH&&mineH.slot)mineH.slot.className="cutslot hot";});
        pitAfter(CUT_FIRST_MS,function(){
          if(!mineH)return;
          mineH.slot.className="cutslot";
          cutTurn(mineH.slot,mineH.card);
        });
        pitAfter(CUT_FIRST_MS+CUT_FLIP_MS,function(){if(mineH)cutTell("you drew "+mineH.card+".");});
        rest.forEach(function(h,i){
          var start=CUT_FIRST_MS+(i+1)*CUT_GAP_MS;
          var label=rest.length===1?"them":(h.name||"them");
          pitAfter(start-CUT_TEASE_MS,function(){
            h.slot.className="cutslot hot";
            cutTell("and for "+label+"\u2026");
          });
          pitAfter(start,function(){
            h.slot.className="cutslot";
            cutTurn(h.slot,h.card);
          });
        });
        var lastAt=CUT_FIRST_MS+Math.max(1,rest.length)*CUT_GAP_MS+CUT_FLIP_MS;
        pitAfter(lastAt,function(){
          if(d.winner){
            cutHands.forEach(function(h){
              if((h.you&&won)||(!h.you&&h.name===d.winner))h.slot.className="cutslot won";
            });
          }
          cutTell(d.winner?(won?"yours is higher.":(many?d.winner+" is higher.":"theirs is higher.")):"");
          pitAfter(420,function(){
            big.style.visibility="";
            again.style.visibility="";
            if(d.winner&&won)celebrate(d.pot,potx);
          });
        });
      }
    }
    pitPaintClock();
    if(d.state!=="done"&&!PIT.tick)PIT.tick=setInterval(pitPaintClock,200);
  }

  /* ---- the clash ----
     A round is two hidden picks that become one outcome, so it is shown as
     exactly that: the two moves slide in from opposite sides onto the same
     line, meet in the middle, and the loser is taken out of the world — the
     winner ends up standing alone where they met. A tie has nothing to
     resolve, so the two rebound off each other and go back where they came
     from. The name of the move that took it is the headline; who that was
     good news for is the line under it, because the move alone does not say. */
  function clashFighter(move){
    var f=el("div","cfighter");
    var ic=el("div","cic");ic.appendChild(moveIcon(move));
    f.appendChild(ic);
    f.appendChild(el("span","cnm",moveName(move)));
    return f;
  }
  function pitClash(d,rr,done){
    PIT.busy=true;
    var cfg=PIT_GAMES[d.game]||PIT_GAMES.tung;
    var v=mount(cfg.name,gameIcon("pit-"+d.game));VIEW="pit";paintRound();
    var back=v.parentNode.querySelector(".casback");
    paintBack(back,function(){pitStop();viewPit(d.game);});
    var head=el("div","pitvs");
    head.appendChild(el("span","pn",d.you||"you"));
    head.appendChild(el("span","pvs","vs"));
    head.appendChild(el("span","pn",d.theirName||"\u2026"));
    v.appendChild(head);
    v.appendChild(el("div","pitpot","round "+d.rounds.length));

    var mineMove=d.youAreHost?rr.host:rr.guest;
    var theirMove=d.youAreHost?rr.guest:rr.host;
    var tie=rr.won===null;
    var iWon=!tie&&rr.won===d.you;

    var stage=el("div","clash");
    var L=clashFighter(mineMove),R=clashFighter(theirMove);
    var spark=el("div","cspark");
    stage.appendChild(L);stage.appendChild(R);stage.appendChild(spark);
    v.appendChild(stage);
    var say=el("div","clashsay","");v.appendChild(say);
    var sub=el("div","clashsub","");v.appendChild(sub);

    var OUT=112,MEET=30;
    function at(el2,x,extra){el2.style.transform="translate(-50%,-50%) translateX("+x+"px)"+(extra||"");}
    at(L,-OUT);at(R,OUT);
    void stage.offsetWidth;                 /* start from the outer marks, not from nowhere */

    pitAfter(40,function(){at(L,-MEET);at(R,MEET);});
    pitAfter(40+CL_IN_MS,function(){
      spark.className="cspark go";
      if(tie){
        /* nothing gives, so they come off each other */
        at(L,-OUT);at(R,OUT);
      }else{
        var win=iWon?L:R, lose=iWon?R:L;
        win.classList.add("cwin");
        at(win,0," scale(1.16)");
        /* the loser is pushed through and gone */
        at(lose,(lose===L?-1:1)*(MEET-14)," scale(.3)");
        lose.classList.add("cgone");
      }
    });
    pitAfter(40+CL_SAY_MS,function(){
      say.textContent=tie?"tie":(moveName(iWon?mineMove:theirMove)+" wins");
      say.className="clashsay show"+(tie?"":(iWon?" win":" lose"));
      sub.textContent=tie
        ?(moveName(mineMove)+" against "+moveName(theirMove)+". play it again.")
        :(iWon?"you take the round.":"they take the round.");
      sub.className="clashsub show";
    });
    pitAfter(CL_HOLD_MS,function(){done();});
  }

  /* The two stacks side by side. The live one hands its numbers to the clock
     tick, so a roll either player makes moves them without rebuilding the
     screen under the hands of whoever is mid-click. */
  /* Every stack at the table, in seat order. A round can seat two, three or
     four, and the stacks ARE the scoreboard, so all of them are public the
     whole way through — watching one climb is as much the game as moving your
     own. the players list is the server's seat list; the two-player fallback is only
     for a record dealt before it shipped one. */
  function compSeats(d){
    if(d&&d.players&&d.players.length)return d.players;
    return [{name:d.you||"you",you:true,chips:d&&d.yourChips},
            {name:(d&&d.theirName)||"them",you:false,chips:d&&d.theirChips}];
  }
  function chipsOf(p){var n=Number(p&&p.chips);return isFinite(n)?n:0;}
  /* the biggest pile at the table. more than one name means a dead heat, and a
     dead heat splits the pot rather than voiding it. */
  function compTop(seats){
    var best=-Infinity;
    seats.forEach(function(p){var c=chipsOf(p);if(c>best)best=c;});
    return seats.filter(function(p){return chipsOf(p)===best;});
  }
  function compScore(d,fin){
    var seats=compSeats(d);
    var two=seats.length===2;
    var lead={};
    if(fin)compTop(seats).forEach(function(p){lead[p.name]=1;});
    var sc=el("div","compscore"+(fin?" fin":""));
    var live=[];
    seats.forEach(function(p,i){
      /* at two the unit sits between the pair, the way it always has; at three
         and four that would be three "wood"s in a row, so it goes on the end */
      if(i)sc.appendChild(el("span","cvs",two?"wood":"vs"));
      var box=el("div","cstack"+(fin&&lead[p.name]?" up":""));
      box.appendChild(el("b",null,p.you?"you":(p.name||"them")));
      var v=el("span","cv",money(chipsOf(p)));box.appendChild(v);
      sc.appendChild(box);
      live.push({you:!!p.you,el:v});
    });
    if(!two)sc.appendChild(el("span","cvs","wood"));
    if(!fin)PIT.chips=live;
    return sc;
  }

  function many2(d){return((d&&d.players&&d.players.length)||(d&&d.seats)||2)>2;}

  /* "you", "you and B", "A, B and C" — the players on one side of a result,
     with your own name replaced by the word for it */
  function nameList(rows,me){
    var out=rows.map(function(x){return x.name===me?"you":x.name;});
    if(out.length<=1)return out[0]||"";
    return out.slice(0,-1).join(", ")+" and "+out[out.length-1];
  }

  /* every round already played, from your side of the table */
  function pitHistory(body,d){
    if(!d.rounds||!d.rounds.length)return;
    var hist=el("div","pithist");
    d.rounds.forEach(function(rr,i){
      var line=el("div","ph");
      line.appendChild(el("span","phn",String(i+1)));
      line.appendChild(moveIcon(d.youAreHost?rr.host:rr.guest));
      line.appendChild(el("span","phv",rr.won===null?"tie":(rr.won===d.you?"you":"them")));
      line.appendChild(moveIcon(d.youAreHost?rr.guest:rr.host));
      hist.appendChild(line);
    });
    body.appendChild(hist);
  }

  /* mm:ss, and tenths once it is under ten seconds, which is when tenths are
     the only thing you are looking at */
  function chClockText(ms){
    ms=Math.max(0,ms);
    if(ms<10000)return (Math.floor(ms/100)/10).toFixed(1);
    var t=Math.ceil(ms/1000);
    var m=Math.floor(t/60),ss=t%60;
    return m+":"+(ss<10?"0":"")+ss;
  }
  /* Both clocks, ticked here rather than fetched. The server sends what each
     player has left and when the running one started; the difference is
     arithmetic, so a countdown costs nothing and does not stutter between
     polls. PIT.skew is the server/client offset the pit already tracks. */
  function chPaintClocks(){
    var cl=PIT.chClocks;
    if(!cl||!cl.top||!cl.top.isConnected)return;
    var c=cl.view;
    if(!c||!c.clock)return;
    var now=Date.now()+PIT.skew;
    for(var seat=0;seat<2;seat++){
      var left=c.clock[seat];
      if(c.running===seat)left=left-Math.max(0,now-c.since);
      var box=(seat===c.yourSeat)?cl.bot:cl.top;
      if(!box)continue;
      box.textContent=chClockText(left);
      box.className="chclock"+(c.running===seat?" on":"")+(left<=10000?" low":"")+(left<=0?" out":"");
    }
  }
  /* The only things that move between rebuilds: the countdowns, and — while a
     round is running — the two stacks, which change on every roll either of
     them makes and must not take the screen with them. */
  function pitPaintClock(){
    var d=PIT.last;
    if(!d)return;
    chPaintClocks();
    if(PIT.chips&&PIT.chips.length&&PIT.chips[0].el.isConnected){
      var seats=compSeats(d);
      PIT.chips.forEach(function(c,i){
        /* our own number is the held one while a table is still showing a
           wager — see roundBet. everyone else's is whatever the poll last saw. */
        if(c.you&&ROUND.live&&ROUND.live.id===d.id){c.el.textContent=money(ROUND.mine);return;}
        c.el.textContent=money(chipsOf(seats[i]||{}));
      });
    }
    if(PIT.pkUp&&PIT.pkUp.isConnected&&PIT.pkUpAt){
      PIT.pkUp.textContent="up in "+pitClockText(pitLeft(PIT.pkUpAt));
    }
    if(!PIT.left||!PIT.left.isConnected)return;
    if(d.state==="done"||!d.deadline){PIT.left.textContent="";PIT.left.className="pitclock";return;}
    /* a chess game has two clocks of its own, drawn beside the board where you
       are already looking. This big number is the same figure a third time and
       reads as a third rule; it is only worth showing while the table is still
       filling, when it is the wait rather than the game. */
    if(d.game==="chess"&&d.state==="live"){PIT.left.textContent="";PIT.left.className="pitclock";return;}
    var ms=pitLeft(d.deadline);
    PIT.left.textContent=pitClockText(ms);
    /* three minutes is not ten seconds: "hot" has to mean something different
       on a round than it does on a confirm nobody has given yet */
    var hot=d.game==="comp"?15000:4000;
    PIT.left.className="pitclock"+(ms<=hot?" hot":"");
  }

  /* ---------- SHOP ---------- */
  function viewShop(){
    var v=mount("Shop","🛒");VIEW="shop";
    var r=res(v);
    var listWrap=el("div",null,"");v.appendChild(listWrap);
    function shopLoad(){
      listWrap.innerHTML="";
      listWrap.appendChild(el("div","casnote","loading shop..."));
      jget("/shop/list?token="+encodeURIComponent(tok())).then(function(d){
        listWrap.innerHTML="";
        if(refused(d)){refusedGate();return;}
        if(d.error){bad(r,d.error);return;}
        setBal(d.balance);
        var pending=d.pending||[];
        var items=d.items||[];
        if(!pending.length&&!items.length){
          listWrap.appendChild(el("div","casnote","the shelves are empty. tung hasn't stocked the shop yet."));
          return;
        }
        if(pending.length){
          listWrap.appendChild(el("div","casnote","unfinished. you already paid. tung is still waiting."));
          pending.forEach(function(p){
            var box=el("div","shopitem wait");
            var g=el("div","grow");
            g.appendChild(el("h4",null,p.name||"offering"));
            g.appendChild(el("p",null,"unfinished. tung is still waiting."));
            if(p.output)g.appendChild(el("p",null,p.output));
            box.appendChild(g);
            box.appendChild(el("div","price","paid"));
            var ans=el("button","cbtn","answer him");
            ans.onclick=function(){shopCollect(p);};
            box.appendChild(ans);
            listWrap.appendChild(box);
          });
        }
        if(items.length){
          if(pending.length)listWrap.appendChild(el("div","casnote","the shelves"));
          items.forEach(function(it){
            var box=el("div","shopitem");
            var g=el("div","grow");g.appendChild(el("h4",null,it.name));if(it.desc)g.appendChild(el("p",null,it.desc));
            /* an item that unlocks a skin says so, and says when it is already
               yours — buying it twice would just be a donation */
            if(it.themeName)g.appendChild(el("p",null,it.owned?("unlocks the "+it.themeName+" theme — already yours."):("unlocks the "+it.themeName+" theme.")));
            box.appendChild(g);
            box.appendChild(el("div","price",money(it.price)+" sahurs"));
            var buy=el("button","cbtn",it.owned?"owned":"redeem");
            if(it.owned)buy.disabled=true;
            else buy.onclick=function(){shopConfirm(it,buy);};
            box.appendChild(buy);
            listWrap.appendChild(box);
          });
        }
      }).catch(function(){listWrap.innerHTML="";bad(r,"network error");});
    }
    shopLoad();
    function shopPaintOut(text){
      var prev=v.querySelector(".shopout");if(prev)prev.remove();
      if(!text)return;
      var ob=el("div","shopout",text);
      ob.style.cssText="margin:8px 0;padding:10px 12px;border:1px solid #7a5a1a;border-radius:8px;background:#160d04;color:#f2c063;white-space:pre-wrap;word-break:break-word;font-size:13px;user-select:text";
      if(r.nextSibling)v.insertBefore(ob,r.nextSibling);else v.appendChild(ob);
    }
    function shopRedeem(it,buy,done){
      buy.disabled=true;
      jpost("/shop/redeem",{itemId:it.id}).then(function(rr){if(refused(rr)){refusedGate();return;}
        buy.disabled=false;
        if(rr.error){done(rr);return;}
        setBal(rr.balance);ok(r,"redeemed "+rr.item+". tung has been notified. he did not smile.");
        shopPaintOut(rr.output);
        shopLoad();
        done(rr);
      }).catch(function(){buy.disabled=false;done({error:"network error"});});
    }
    /* buy first. the question field is a stranger until the sahurs have moved.
       same tung-brown card as the tip overlay, two beats: pay, then speak.
       walking away after pay must leave the owed question on the shelf. */
    function shopOverlay(spec){
      var old=document.getElementById("shopOverlay");
      if(old&&old.parentNode)old.parentNode.removeChild(old);
      var ov=el("div","ov");ov.id="shopOverlay";ov.setAttribute("role","dialog");
      var card=el("div","ovcard");
      card.appendChild(el("h3",null,spec.title));
      card.appendChild(el("p","ovsub",spec.sub));
      var inp=null;
      if(spec.ask){
        card.appendChild(el("p","ovsub",spec.ask));
        inp=el("input");inp.id="shopAsk";inp.placeholder="tung is listening";
        inp.maxLength=200;card.appendChild(inp);
      }
      var err=el("p","overr","");card.appendChild(err);
      var acts=el("div","ovacts");
      var yes=el("button",null,spec.yes||"so be it");
      var no=el("button","ghost",spec.no||"walk away");
      function close(){if(ov.parentNode)ov.parentNode.removeChild(ov);}
      function walk(){close();if(spec.onNo)spec.onNo();}
      no.onclick=walk;
      ov.addEventListener("click",function(ev){if(ev.target===ov)walk();});
      yes.onclick=function(){
        var input=inp?String(inp.value||"").trim():"";
        if(inp&&!input){err.textContent="tung asked a question. you stared back. try again.";return;}
        spec.onYes(input,{close:close,err:function(t){err.textContent=t;},busy:function(on){yes.disabled=on;no.disabled=on;}});
      };
      if(inp)inp.addEventListener("keydown",function(ev){if(ev.key==="Enter"){ev.preventDefault();yes.onclick();}});
      acts.appendChild(yes);acts.appendChild(no);card.appendChild(acts);
      ov.appendChild(card);document.body.appendChild(ov);ov.style.display="flex";
      if(inp)try{inp.focus();}catch(e){}
    }
    function shopConfirm(it,buy){
      shopOverlay({
        title:"place it on the altar",
        sub:it.name+" costs "+money(it.price)+" sahurs. tung does not do refunds. tung does not do sympathy.",
        ask:"",
        onYes:function(_input,api){
          api.busy(true);
          shopRedeem(it,buy,function(rr){
            if(rr.error){api.err(rr.error==="insufficient"?"not enough sahurs. the shelves do not do credit.":rr.error);api.busy(false);return;}
            api.close();
            if(rr.pending)shopCollect(rr.pending);
          });
        }
      });
    }
    function shopCollect(p){
      shopOverlay({
        title:"the shelves have you",
        sub:"you already paid. the question remains. walk away and it will still be waiting on the shelf.",
        ask:p.inputLabel,
        yes:"answer him",
        onYes:function(input,api){
          api.busy(true);
          jpost("/shop/tell",{redeemId:p.id,itemId:p.itemId,input:input}).then(function(rr){if(refused(rr)){refusedGate();return;}
            if(rr.error){api.err(rr.error==="nothing to add"?"tung already heard you. or he never will.":rr.error);api.busy(false);return;}
            api.close();
            ok(r,"tung wrote it down. he did not smile.");
            shopPaintOut(rr.output);
            shopLoad();
          }).catch(function(){api.err("the shelves are silent.");api.busy(false);});
        },
        onNo:function(){shopLoad();}
      });
    }
  }
})();
`;

  Shrine.CASINO_JS = CASINO_JS;
})();
