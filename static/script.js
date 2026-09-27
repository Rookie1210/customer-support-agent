(function(){
  "use strict";
  var DEMO=["rahul","priya","arjun"],SUGGESTIONS=["UPI payment is failing again","I tried the suggested fix but it didn't work","Re-authentication fixed it"];
  function read(k,d){
    try{
      var x=localStorage.getItem(k);
      return x===null?d:x
    }
    catch(_e){
      return d
    }
  }
  function save(k,v){
    try{
      localStorage.setItem(k,v)
    }
    catch(_e){
    }
  }
  function ids(){
    var a=DEMO.slice();
    try{
      var x=JSON.parse(localStorage.getItem("support-customer-ids")||"[]");
      if(Array.isArray(x))x.forEach(function(i){
        if(typeof i==="string"&&i.trim()&&i.length<=128&&a.indexOf(i.trim())<0)a.push(i.trim())
      })
    }
    catch(_e){
    }
    return a
  }
  function title(id){
    return({
      rahul:"Rahul",priya:"Priya",arjun:"Arjun"
    })[id.toLowerCase()]||id
  }
  function stamp(){
    return new Intl.DateTimeFormat(undefined,{
      hour:"numeric",minute:"2-digit"
    }).format(new Date())
  }
  var start=read("support-customer-id","rahul");
  if(!start.trim()||start.length>128)start="rahul";
  var state={
    currentCustomerId:start,customerIds:ids(),messages:[],memories:[],memoryMode:"history",memoryLoading:false,memoryError:false,returningCustomer:null,loading:false,error:null,errorScope:null,draft:"",customerDraft:"",creatingCustomer:false,lastFailedMessage:"",generation:0,sequence:0,memoryController:null,chatController:null
  };
  if(state.customerIds.indexOf(start)<0)state.customerIds.push(start);
  var e={
  };
  ["customer-list","customer-total","customer-avatar","conversation-heading","customer-badge","new-customer-button","new-customer-form","new-customer-id","cancel-new-customer","conversation","message-form","message-input","send-button","send-label","clear-conversation","chat-error","chat-error-message","retry-button","scenario-list","memory-count","memory-status","memory-status-title","memory-status-copy","memory-retry","memory-body","memory-footnote-copy"].forEach(function(k){
    e[k]=document.getElementById(k)
  });
  function abort(c){
    if(c)c.abort()
  }
  function setError(m){
    state.error=m;
    state.errorScope="chat"
  }
  function clearError(){
    state.error=null;
    state.errorScope=null
  }
  function renderCustomers(){
    e["customer-list"].replaceChildren();
    state.customerIds.forEach(function(id){
      var b=document.createElement("button");
      b.type="button";
      b.className="customer-item"+(id===state.currentCustomerId?" active":"");
      b.dataset.customerId=id;
      b.setAttribute("aria-current",id===state.currentCustomerId?"true":"false");
      var a=document.createElement("span");
      a.className="small-avatar";
      a.textContent=id.charAt(0).toUpperCase();
      var c=document.createElement("span");
      c.className="customer-copy";
      var n=document.createElement("strong");
      n.textContent=title(id);
      var s=document.createElement("small");
      s.textContent=id;
      c.append(n,s);
      var d=document.createElement("i");
      d.className="active-dot";
      b.append(a,c,d);
      e["customer-list"].append(b)
    });
    e["customer-total"].textContent=String(state.customerIds.length);
    e["new-customer-form"].hidden=!state.creatingCustomer;
    e["new-customer-button"].setAttribute("aria-expanded",String(state.creatingCustomer));
    if(e["new-customer-id"].value!==state.customerDraft)e["new-customer-id"].value=state.customerDraft
  }
  function renderCustomer(){
    var id=state.currentCustomerId;
    e["conversation-heading"].textContent=title(id);
    e["customer-avatar"].textContent=id.charAt(0).toUpperCase();
    e["customer-badge"].textContent=state.memoryLoading&&state.returningCustomer===null?"Checking history":state.memoryError?"History unavailable":state.returningCustomer?"Returning customer":"New customer";
    e["customer-badge"].dataset.kind=state.memoryError?"error":state.returningCustomer?"returning":"new"
  }
  function message(role,text,t){
    var row=document.createElement("article");
    row.className="message-row "+role;
    var av=document.createElement("span");
    av.className="message-avatar";
    av.textContent=role==="user"?state.currentCustomerId.charAt(0).toUpperCase():"M";
    var content=document.createElement("div");
    content.className="message-content";
    var meta=document.createElement("div");
    meta.className="message-meta";
    var who=document.createElement("strong");
    who.textContent=role==="user"?title(state.currentCustomerId):"MemorySupport AI";
    var time=document.createElement("time");
    time.textContent=t||stamp();
    meta.append(who,time);
    var bubble=document.createElement("div");
    bubble.className="bubble";
    bubble.textContent=text;
    content.append(meta,bubble);
    if(role==="user")row.append(content,av);
    else row.append(av,content);
    e.conversation.append(row)
  }
  function pending(){
    var row=document.createElement("article");
    row.className="message-row assistant pending";
    var av=document.createElement("span");
    av.className="message-avatar";
    av.textContent="M";
    var c=document.createElement("div");
    c.className="message-content";
    var meta=document.createElement("div");
    meta.className="message-meta";
    var n=document.createElement("strong");
    n.textContent="MemorySupport AI";
    var t=document.createElement("time");
    t.textContent=stamp();
    meta.append(n,t);
    var bubble=document.createElement("div");
    bubble.className="bubble";
    bubble.setAttribute("role","status");
    bubble.textContent="Searching history and preparing a reply…";
    c.append(meta,bubble);
    row.append(av,c);
    e.conversation.append(row)
  }
  function renderConversation(){
    e.conversation.replaceChildren();
    if(!state.messages.length){
      var box=document.createElement("div");
      box.className="empty-chat";
      var icon=document.createElement("span");
      icon.className="empty-symbol";
      icon.textContent="✦";
      var h=document.createElement("strong");
      h.textContent="How can we help "+title(state.currentCustomerId)+"?";
      var p=document.createElement("p");
      p.textContent="Send a message to start. Relevant Hindsight history will be used when available.";
      box.append(icon,h,p);
      e.conversation.append(box)
    }
    else state.messages.forEach(function(m){
      message(m.role,m.text,m.time)
    });
    if(state.loading)pending();
    e["message-input"].value=state.draft;
    e["message-input"].disabled=state.loading;
    e["send-button"].disabled=state.loading;
    e["send-label"].textContent=state.loading?"Working…":"Send";
    e["clear-conversation"].disabled=state.loading;
    e["chat-error"].hidden=!(state.error&&state.errorScope==="chat");
    e["chat-error-message"].textContent=state.errorScope==="chat"?state.error||"":"";
    e["retry-button"].hidden=!(state.error&&state.lastFailedMessage);
    e.conversation.scrollTop=e.conversation.scrollHeight
  }
  function fact(parent,name,value){
    var card=document.createElement("div");
    card.className="profile-fact";
    var h=document.createElement("small");
    h.textContent=name;
    var v=document.createElement("strong");
    v.textContent=value;
    card.append(h,v);
    parent.append(card)
  }
  function field(text,key){
    var names=key==="Platform(?:/context)?"?["platform","platform/context"]:[key.toLowerCase()];
    for(var line of text.split(/\r?\n/)){
      var pos=line.indexOf(":");
      if(pos<0)continue;
      var name=line.slice(0,pos).trim().toLowerCase();
      if(names.indexOf(name)>=0)return line.slice(pos+1).trim()
    }
    return ""
  }
  function parsed(raw){
    if(typeof raw==="string")raw={
      text:raw
    };
    if(!raw||typeof raw.text!=="string"||!raw.text.trim())return null;
    var text=raw.text,v=text.toLowerCase().replace(/[\u2010-\u2014]/g,"-");
    var issue=raw.issue||field(text,"Issue");
    if(!issue)issue=/\bupi\b/.test(v)&&/payment|transaction/.test(v)?"UPI payment":/payment|transaction/.test(v)?"Payment":/login|sign in|account access/.test(v)?"Account access":/order|delivery|shipment/.test(v)?"Order or delivery":/refund/.test(v)?"Refund":"";
    var platform=raw.platform||field(text,"Platform(?:/context)?");
    if(platform==="Not specified")platform="";
    if(!platform)platform=/\bandroid\b/.test(v)?"Android":/\b(?:ios|iphone|ipad)\b/.test(v)?"iOS":/website|web app|browser/.test(v)?"Web":"";
    var solution=raw.solution||field(text,"Solution");
    if(!solution||/no specific solution identified/i.test(solution))solution=/re[\s-]?auth|reauth|re[\s-]?link/.test(v)?"Re-authenticate or re-link UPI":/clear(?:ing)? (?:the )?cache/.test(v)?"Clear cache":/reinstall/.test(v)?"Reinstall the app":/restart(?:ing)? (?:the )?(?:app|device|phone)/.test(v)?"Restart the app or device":/update(?:d|ing)? (?:the )?app/.test(v)?"Update the app":/contact(?:ing)? (?:your )?(?:bank|support)/.test(v)?"Contact the bank or support":"";
    var outcome=raw.outcome||field(text,"Outcome").toLowerCase();
    if(!/^(worked|failed|attempted|unconfirmed)$/.test(outcome))outcome=/didn['’]?t work|did not work|failed to resolve|no change|persisted|remained unresolved|still unresolved/.test(v)?"failed":/previously resolved|successfully resolved|outcome[^\n]*worked|\b(?:worked|fixed|solved|effective)\b/.test(v)?"worked":/\battempted\b|\bi tried\b/.test(v)?"attempted":/advised|recommended|suggested/.test(v)?"unconfirmed":solution?"unconfirmed":"";
    var customerMessage=raw.customer_message||field(text,"Customer message");
    var recent=customerMessage||(issue?issue+(outcome==="failed"?" — customer reported it did not resolve the issue":outcome==="worked"?" — customer confirmed the issue was resolved":outcome==="attempted"?" — customer reported trying a solution":""):"");
    return{
      text:text,issue:issue,platform:platform,solution:solution,outcome:outcome,recent:recent
    }
  }
  function listMemories(){
    var seen=Object.create(null),out=[];
    (Array.isArray(state.memories)?state.memories:[]).forEach(function(r){
      var x=parsed(r);
      if(!x)return;
      var k=x.text.trim().replace(/\s+/g," ").toLowerCase();
      if(!seen[k]){
        seen[k]=1;
        out.push(x)
      }
    });
    return out
  }
  function sectionTitle(text){
    var h=document.createElement("h3");
    h.className="section-title";
    h.textContent=text;
    return h
  }
  function renderMemoryBody(items){
    e["memory-body"].replaceChildren();
    if(!items.length){
      var empty=document.createElement("div");
      empty.className="memory-empty";
      var icon=document.createElement("b");
      icon.textContent="▤";
      var titleNode=document.createElement("strong");
      titleNode.textContent="No previous support history for this customer.";
      var p=document.createElement("p");
      p.textContent="When Hindsight has relevant history, it will appear here.";
      empty.append(icon,titleNode,p);
      e["memory-body"].append(empty);
      return
    }
    var profile=document.createElement("section");
    profile.className="memory-section";
    profile.append(sectionTitle("CUSTOMER PROFILE"));
    var grid=document.createElement("div");
    grid.className="profile-grid";
    fact(grid,"CUSTOMER",title(state.currentCustomerId));
    var issue=items.find(function(x){
      return x.issue
    }),platform=items.find(function(x){
      return x.platform
    });
    if(platform)fact(grid,"PLATFORM",platform.platform);
    if(issue)fact(grid,"KNOWN ISSUE",issue.issue);
    profile.append(grid);
    e["memory-body"].append(profile);
    var seen=Object.create(null),solutions=[];
    items.forEach(function(x){
      if(!x.solution)return;
      var outcome=x.outcome||"unconfirmed",key=x.solution.toLowerCase().replace(/[^a-z0-9]+/g," ").trim()+":"+outcome;
      if(!seen[key]){
        seen[key]=1;
        solutions.push({
          name:x.solution,outcome:outcome
        })
      }
    });
    if(solutions.length){
      var section=document.createElement("section");
      section.className="memory-section";
      section.append(sectionTitle("PREVIOUS SOLUTIONS"));
      var list=document.createElement("div");
      list.className="solution-list";
      solutions.forEach(function(x){
        var row=document.createElement("div");
        row.className="solution-item";
        var icon=document.createElement("span");
        icon.className="solution-icon";
        icon.textContent=x.outcome==="worked"?"✓":x.outcome==="failed"?"×":"?";
        var copy=document.createElement("span");
        copy.className="solution-copy";
        var name=document.createElement("strong");
        name.textContent=x.name;
        var badge=document.createElement("span");
        badge.className="outcome outcome-"+x.outcome;
        badge.textContent=x.outcome==="worked"?"SUCCESS":x.outcome==="failed"?"FAILED":x.outcome==="attempted"?"ATTEMPTED":"UNCONFIRMED";
        copy.append(name,badge);
        row.append(icon,copy);
        list.append(row)
      });
      section.append(list);
      e["memory-body"].append(section)
    }
    var seenHistory=Object.create(null),history=[];
    items.forEach(function(x){
      if(x.recent){
        var k=x.recent.toLowerCase().replace(/\s+/g," ").trim();
        if(!seenHistory[k]){
          seenHistory[k]=1;
          history.push(x.recent)
        }
      }
    });
    if(history.length){
      var section2=document.createElement("section");
      section2.className="memory-section";
      section2.append(sectionTitle("RECENT HISTORY"));
      var list2=document.createElement("div");
      list2.className="history-list";
      history.slice(0,5).forEach(function(x){
        var row=document.createElement("div");
        row.className="history-item";
        row.textContent=x;
        list2.append(row)
      });
      section2.append(list2);
      e["memory-body"].append(section2)
    }
  }
  function renderMemories(){
    var items=listMemories();
    e["memory-count"].textContent=String(items.length);
    var kind=state.memoryLoading?"loading":state.memoryError?"error":items.length?"ready":"empty";
    e["memory-status"].dataset.kind=kind;
    if(state.memoryLoading){
      e["memory-status-title"].textContent="Loading customer history";
      e["memory-status-copy"].textContent="Searching Hindsight for "+state.currentCustomerId+"’s support history."
    }
    else if(state.memoryError){
      e["memory-status-title"].textContent="History unavailable";
      e["memory-status-copy"].textContent="Unable to load this customer’s history. Try again."
    }
    else if(state.memoryMode==="response"&&items.length){
      e["memory-status-title"].textContent=items.length+" memories used for this response";
      e["memory-status-copy"].textContent="These memories were returned to the support agent for this reply."
    }
    else if(state.memoryMode==="response"){
      e["memory-status-title"].textContent="New customer — no previous support history.";
      e["memory-status-copy"].textContent="The assistant replied without claiming to remember earlier interactions."
    }
    else if(items.length){
      e["memory-status-title"].textContent=items.length+" memories in customer history";
      e["memory-status-copy"].textContent="Only Hindsight records for "+state.currentCustomerId+" are shown."
    }
    else{
      e["memory-status-title"].textContent="New customer — no previous support history.";
      e["memory-status-copy"].textContent="No previous support history for this customer."
    }
    e["memory-retry"].hidden=!state.memoryError;
    e["memory-footnote-copy"].textContent=state.memoryMode==="response"?"Memories shown here were returned for the latest AI response.":"Only memories retrieved for this customer are shown.";
    renderMemoryBody(items)
  }
  function render(){
    renderCustomers();
    renderCustomer();
    renderConversation();
    renderMemories()
  }
  function loadCustomerMemories(id,generation){
    abort(state.memoryController);
    var c=new AbortController();
    state.memoryController=c;
    state.memoryLoading=true;
    state.memoryError=false;
    state.returningCustomer=null;
    state.memoryMode="history";
    state.memories=[];
    render();
    fetch("/customers/"+encodeURIComponent(id)+"/memories",{
      headers:{
        Accept:"application/json"
      },signal:c.signal
    }).then(function(r){
      return r.json().catch(function(){
        return{
        }
      }).then(function(d){
        if(!r.ok)throw Error("history");
        return d
      })
    }).then(function(d){
      if(generation!==state.generation||id!==state.currentCustomerId||state.memoryMode!=="history")return;
      state.memoryLoading=false;
      state.memoryError=false;
      state.memories=Array.isArray(d.memories)?d.memories:[];
      state.returningCustomer=state.memories.length>0;
      render()
    }).catch(function(){
      if(generation!==state.generation||id!==state.currentCustomerId||state.memoryMode!=="history")return;
      state.memoryLoading=false;
      state.memoryError=true;
      state.returningCustomer=false;
      render()
    })
  }
  function setCurrentCustomer(id){
    var next=typeof id==="string"?id.trim():"";
    if(!next||next.length>128){
      setError("Enter a customer ID between 1 and 128 characters.");
      render();
      return
    }
    if(next===state.currentCustomerId){
      state.creatingCustomer=false;
      state.customerDraft="";
      clearError();
      render();
      return
    }
    state.generation++;
    state.sequence++;
    abort(state.chatController);
    abort(state.memoryController);
    state.chatController=null;
    state.memoryController=null;
    state.currentCustomerId=next;
    state.messages=[];
    state.memories=[];
    state.memoryMode="history";
    state.memoryLoading=false;
    state.memoryError=false;
    state.returningCustomer=null;
    state.loading=false;
    state.draft="";
    state.lastFailedMessage="";
    state.creatingCustomer=false;
    state.customerDraft="";
    clearError();
    if(state.customerIds.indexOf(next)<0)state.customerIds.push(next);
    save("support-customer-ids",JSON.stringify(state.customerIds));
    save("support-customer-id",next);
    render();
    loadCustomerMemories(next,state.generation)
  }
  function retryMemoryLoad(){
    state.generation++;
    abort(state.memoryController);
    state.messages=[];
    state.memories=[];
    state.memoryMode="history";
    state.memoryLoading=false;
    state.memoryError=false;
    state.returningCustomer=null;
    state.loading=false;
    state.lastFailedMessage="";
    clearError();
    render();
    loadCustomerMemories(state.currentCustomerId,state.generation)
  }
  function isCurrentRequest(customerId,generation,sequence){
    return generation===state.generation&&sequence===state.sequence&&customerId===state.currentCustomerId
  }
  function handleResponse(data,customerId,generation,sequence){
    if(!isCurrentRequest(customerId,generation,sequence))return;
    state.loading=false;
    state.memoryLoading=false;
    state.error=null;
    state.errorScope=null;
    state.lastFailedMessage="";
    state.messages.push({role:"assistant",text:data.response,time:stamp()});
    state.memories=Array.isArray(data.memories)?data.memories:[];
    state.memoryMode="response";
    state.memoryError=false;
    if(state.memories.length)state.returningCustomer=true;
    render()
  }
  function handleError(message,customerId,generation,sequence){
    if(!isCurrentRequest(customerId,generation,sequence))return;
    state.loading=false;
    state.memoryLoading=false;
    state.memoryMode="history";
    state.lastFailedMessage=message;
    setError("Unable to reach the support agent. Try again.");
    render()
  }
  function sendMessage(text,retry){
    var id=state.currentCustomerId,msg=typeof text==="string"?text.trim():"";
    if(!id){
      setError("Select a customer before sending.");
      render();
      return
    }
    if(!msg){
      setError("Enter a message before sending.");
      render();
      e["message-input"].focus();
      return
    }
    if(msg.length>4000){
      setError("Messages must be 4,000 characters or fewer.");
      render();
      return
    }
    if(state.loading)return;
    clearError();
    state.lastFailedMessage="";
    if(!retry)state.messages.push({
      role:"user",text:msg,time:stamp()
    });
    state.draft="";
    state.loading=true;
    state.memoryLoading=true;
    state.memoryError=false;
    state.memoryMode="pending";
    state.memories=[];
    state.sequence++;
    var seq=state.sequence,gen=state.generation,c=new AbortController();
    state.chatController=c;
    console.debug("Sending support request for customer ID:",id);
    render();
    fetch("/chat",{
      method:"POST",headers:{
        "Content-Type":"application/json",Accept:"application/json"
      },body:JSON.stringify({
        customer_id:id,message:msg
      }),signal:c.signal
    }).then(function(r){
      return r.json().catch(function(){
        return{
        }
      }).then(function(d){
        if(!r.ok||typeof d.response!=="string")throw Error("chat");
        return d
      })
    }).then(function(d){
      handleResponse(d,id,gen,seq)
    }).catch(function(){
      handleError(msg,id,gen,seq)
    })
  }
  SUGGESTIONS.forEach(function(msg){
    var b=document.createElement("button");
    b.type="button";
    b.className="scenario";
    b.textContent=msg;
    b.addEventListener("click",function(){
      state.draft=msg;
      clearError();
      render();
      e["message-input"].focus()
    });
    e["scenario-list"].append(b)
  });
  e["customer-list"].addEventListener("click",function(ev){
    var b=ev.target.closest("[data-customer-id]");
    if(b)setCurrentCustomer(b.dataset.customerId)
  });
  e["new-customer-button"].addEventListener("click",function(){
    state.creatingCustomer=!state.creatingCustomer;
    state.customerDraft="";
    clearError();
    render();
    if(state.creatingCustomer)e["new-customer-id"].focus()
  });
  e["new-customer-id"].addEventListener("input",function(ev){
    state.customerDraft=ev.target.value
  });
  e["cancel-new-customer"].addEventListener("click",function(){
    state.creatingCustomer=false;
    state.customerDraft="";
    clearError();
    render()
  });
  e["new-customer-form"].addEventListener("submit",function(ev){
    ev.preventDefault();
    if(!state.customerDraft.trim()){
      setError("Enter a customer ID before opening a customer.");
      render();
      e["new-customer-id"].focus();
      return
    }
    setCurrentCustomer(state.customerDraft)
  });
  e["message-input"].addEventListener("input",function(ev){
    state.draft=ev.target.value
  });
  e["message-form"].addEventListener("submit",function(ev){
    ev.preventDefault();
    sendMessage(state.draft,false)
  });
  e["message-input"].addEventListener("keydown",function(ev){
    if(ev.key==="Enter"&&!ev.shiftKey){
      ev.preventDefault();
      e["message-form"].requestSubmit()
    }
  });
  function clearConversation(){
    if(state.loading)return;
    state.messages=[];
    state.draft="";
    state.lastFailedMessage="";
    clearError();
    render()
  }
  e["clear-conversation"].addEventListener("click",clearConversation);
  e["retry-button"].addEventListener("click",function(){
    if(state.lastFailedMessage&&!state.loading)sendMessage(state.lastFailedMessage,true)
  });
  e["memory-retry"].addEventListener("click",retryMemoryLoad);
  render();
  loadCustomerMemories(state.currentCustomerId,state.generation)
})();
