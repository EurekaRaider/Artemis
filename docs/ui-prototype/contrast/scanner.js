/*!
 * Artemis components.html — 对比度全矩阵扫描器 v17（可复现证据脚本）
 *
 * v17 继承 v16.1 结构审计与 import 块修复；本次新增独立的原型契约与页面布局门禁。
 * v16 变更（回应第十六轮评审阻断②）:
 *  - 取消结构树 64 层静默截断（原 if(d>64)return[] 既不标记也不 fail-closed，
 *     深层 DOM 的 aria 变更会漏报）——递归不再限深。
 *  - 原生交互语义补齐：contenteditable（属性或 isContentEditable property 为真
 *    即编码）、input/textarea/select 当前值（value property，非空才编码）、
 *    href/target/popover/placeholder 属性。仍是固定语义集 + 全部 aria-*，
 *    「全量」声明收回——排除项见 STRUCT_SEMANTIC 注释。
 *
 * v15 变更（回应第十五轮评审阻断项①）:
 *  - 结构不变量改为可逆、无歧义编码：每节点 [tag, attrs, children] 的 JSON
 *    元组树（JSON.stringify 转义、键名稳定排序、JSON.parse 可逆），不再拼接
 *    未转义字符串——id/aria-label 分隔符碰撞反例不可再构造。
 *  - 组合自反 chrome（[data-struct-chrome]：侧栏 dir/theme/contrast 分段控件）内部的
 *    aria-selected/tabindex 为请求组合身份的反射，规范化之——等价类跨组合可比；
 *    chrome 结构与其余属性、一切非 chrome 元素的全部 aria-* 仍在指纹内。
 *  - attrs 稳定排序收录全部 aria-* 与语义属性（id/role/class 规范化集/for/
 *    type/name/tabindex）及原生交互状态（hidden/disabled/readonly/required/
 *    open/checked/selected/inert，property 为权威）。aria-selected 单次扫描
 *    中途翻转必改结构串。
 *
 * v11 变更（回应第十一轮评审收敛三项）:
 *  - coverageOf 改用 Range.getClientRects 只读测量（零 DOM 写入——旧实现写
 *    textContent 会永久删除父元素子节点）；run() 记录扫描前后 DOM 结构哈希
 *    （structHash：元素序列 + 节点计数），结构变化由 runner fail-closed。
 *  - 采样裁剪（4096 / ib×dl）触发时标记 INDETERMINATE_SAMPLING_CAP，
 *    由 runner fail-closed，不再静默给出确定结论。
 * v10 变更（回应第十轮评审第 2 条）:
 *  - 渐变采样与文字覆盖像素绑定（coverageOf，每覆盖像素 1 样本，无硬上限），
 *    只检查覆盖区间 [t0,t1] 内的最差值；前景亮度交点 lum(c(t))=lum(fg) 的
 *    解析解并入采样，覆盖「黑→白过渡恰经前景色」的最差点。
 * v9 变更（回应第九轮评审第 1/2 条）:
 *  - 执行绑定：payload 新增 state = {direction, theme, contrast, nonce}。
 *    nonce 由驱动随请求 URL 注入（&n=…），扫描时从页面真实 DOM 属性 + label 回读——
 *    重放旧 DOM / 事后改写 JSON 均会因 nonce 不匹配被判 NONCE_MISMATCH。
 *  - 偏移可选：Chrome 对省略偏移的渐变计算值不带 0%/100%，仅颜色形态按均匀分布。
 *  - 组级 opacity 语义、无结果 fail-closed、probe、auditCounts 沿用 v8。
 *  - scanAll 以元素遍历代替 TreeWalker（runner 注入环境下 TreeWalker 递归提前终止）。
 */
(function () {
  "use strict";
  if (window.__CONTRAST_SCANNER__) return;
  window.__CONTRAST_SCANNER__ = true;

  /* ---------- 颜色工具 ---------- */
  function parseColor(s) {
    if (!s || s === "none" || s === "transparent") return null;
    s = s.trim();
    if (s[0] === "#") {
      var h = s.slice(1);
      if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
      return { c:[parseInt(h.substr(0,2),16),parseInt(h.substr(2,2),16),parseInt(h.substr(4,2),16)], a:h.length>7?parseInt(h.slice(6,8),16)/255:1 };
    }
    var m = s.match(/rgba?\(([^)]+)\)/);
    if (m) {
      var p = m[1].split(",").map(parseFloat);
      return { c:[p[0],p[1],p[2]], a:p.length>3?p[3]:1 };
    }
    m = s.match(/color\(\s*srgb(?:-linear)?\s+([-\d.eE]+)\s+([-\d.eE]+)\s+([-\d.eE]+)(?:\s*\/\s*([-\d.%]+))?\s*\)/);
    if (m) {
      var cl = function (x) { return Math.max(0, Math.min(255, x*255)); };
      var ar = m[4], al = 1;
      if (ar !== undefined) al = ar.indexOf("%") >= 0 ? parseFloat(ar)/100 : parseFloat(ar);
      return { c:[cl(parseFloat(m[1])),cl(parseFloat(m[2])),cl(parseFloat(m[3]))], a:al };
    }
    return null;
  }
  function hexOf(c){ return "#"+c.map(function(x){return ("0"+Math.round(Math.max(0,Math.min(255,x))).toString(16)).slice(-2);}).join(""); }
  function lum(rgb){
    function f(x){x/=255;return x<=0.03928?x/12.92:Math.pow((x+0.055)/1.055,2.4);}
    return 0.2126*f(rgb[0])+0.7152*f(rgb[1])+0.0722*f(rgb[2]);
  }
  function ratio(a,b){var l1=lum(a),l2=lum(b),hi=Math.max(l1,l2),lo=Math.min(l1,l2);return (hi+0.05)/(lo+0.05);}
  function blend(topRGB,alpha,underRGB){ return topRGB.map(function(cv,i){return cv*alpha+underRGB[i]*(1-alpha);}); }

  /* ---------- 渐变 stop 解析（偏移可选） ---------- */
  function parseGradientStops(bgImage){
    if(!bgImage||bgImage.indexOf("linear-gradient")<0)return null;
    var colRe=/(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|color\(\s*srgb[^)]*\))/g,
        offRe=/^\s*([-\d.]+)(%|px)/, m, stops=[];
    while((m=colRe.exec(bgImage))){
      var p=parseColor(m[1]); if(!p)continue;
      var tail=bgImage.slice(m.index+m[0].length), om=tail.match(offRe);
      var off=om?parseFloat(om[1]):null, unit=om?om[2]:"%";
      stops.push({c:p.c,a:p.a,off:off,unit:unit,pct:unit==="%"&&off!==null});
    }
    if(stops.length===0)return null;
    var allPct=stops.every(function(s){return s.pct;});
    if(allPct){
      stops.forEach(function(s){ s.t=Math.max(0,Math.min(1,s.off/100)); });
      stops.sort(function(a,b){return a.t-b.t;});
    }else{
      stops.forEach(function(s,i){ s.t=stops.length===1?0:i/(stops.length-1); });
    }
    return stops;
  }
  /* 按覆盖像素宽度采样：count ≈ 文字覆盖像素宽（无硬上限），并入 stop 端点；premultiplied 插值 */
  function gradientSamples(stops,count){
    var ts=[],i,j;
    for(i=0;i<count;i++)ts.push(i/(count-1));
    stops.forEach(function(s){ts.push(s.t);});
    ts.sort(function(a,b){return a-b;});
    var uniq=[];
    ts.forEach(function(t){ if(!uniq.length||t-uniq[uniq.length-1]>1e-6)uniq.push(t); });
    var out=[];
    for(i=0;i<uniq.length;i++){
      var t=uniq[i],s0=stops[0],s1=stops[stops.length-1],u=0;
      if(t<=stops[0].t){ s0=s1=stops[0]; }
      else if(t>=stops[stops.length-1].t){ s0=s1=stops[stops.length-1]; }
      else { for(j=0;j<stops.length-1;j++){ if(t>=stops[j].t&&t<=stops[j+1].t){ s0=stops[j]; s1=stops[j+1]; break; } } }
      var span=s1.t-s0.t; u=span>0?(t-s0.t)/span:0;
      var a=s0.a*(1-u)+s1.a*u, c=[0,0,0];
      if(a>0){ for(j=0;j<3;j++) c[j]=((s0.c[j]*s0.a)*(1-u)+(s1.c[j]*s1.a)*u)/a; }
      out.push({c:c,a:a,t:t});
    }
    return out;
  }
  function stride(arr,n){
    if(arr.length<=n)return arr;
    var out=[],step=arr.length/n;
    for(var i=0;i<n;i++)out.push(arr[Math.round(i*step)]);
    return out;
  }

  /* 文字覆盖像素区间（document 坐标；R11①：Range 只读测量，零 DOM 写入——
     旧实现写 textContent 会永久删除父元素子节点） */
  function textNodesOf(el){
    var out=[];
    (function rec(n,d){
      if(d>32)return;
      for(var c=n.firstChild;c;c=c.nextSibling){
        if(c.nodeType===3){ if(c.nodeValue.replace(/\s+/g,"")) out.push(c); }
        else if(c.nodeType===1) rec(c,d+1);
      }
    })(el,0);
    return out;
  }
  function coverageOf(el){
    var minX=Infinity,maxX=-Infinity,found=false;
    var dr=document.documentElement.getBoundingClientRect();
    var nodes=textNodesOf(el);
    for(var i=0;i<nodes.length;i++){
      var rg=document.createRange(); rg.selectNodeContents(nodes[i]);
      var rects=rg.getClientRects();
      for(var j=0;j<rects.length;j++){
        var rc=rects[j];
        if(rc.width<=0&&rc.height<=0)continue;
        if(rc.left<minX)minX=rc.left;
        if(rc.right>maxX)maxX=rc.right;
        found=true;
      }
    }
    if(!found)return null;
    return {minX:minX-dr.left,maxX:maxX-dr.left};
  }
  /* ---------- 链构建：root→el 顺序 ---------- */
  function chainOf(el){
    var up=[],cur=el;
    while(cur&&cur.nodeType===1&&up.length<64){up.push(cur);cur=cur.parentElement;}
    up.reverse();                      // [0]=html … [n]=el
    var prefix=[];
    for(var i=0;i<up.length;i++){
      var op=parseFloat(getComputedStyle(up[i]).opacity);
      if(isNaN(op))op=1;
      prefix[i]=op;
    }
    return {nodes:up,opEach:prefix};
  }
  function layerAlpha(ownerIdx,ch){
    var m=1;for(var i=0;i<=ownerIdx;i++)m*=ch.opEach[i];
    return m;
  }
  function pageBase(ch){
    for(var i=0;i<ch.nodes.length;i++){
      var op=parseFloat(getComputedStyle(ch.nodes[i]).opacity);
      if(!(op>=0.99))continue;
      var p=parseColor(getComputedStyle(ch.nodes[i]).backgroundColor);
      if(p&&p.a>=0.99)return p.c;
    }
    return [255,255,255];
  }

  /* ---------- 候选展开：bg-color 在下，渐变样本分支叠上 ---------- */
  function expandLayer(cands,cs,la,stops,samples){
    var bc=parseColor(cs.backgroundColor);
    if((!bc||bc.a<=0)&&!samples)return cands;
    var next=[];
    cands.forEach(function(u){
      var base=u;                                          // t 沿合成继承
      if(bc&&bc.a>0){
        var ca=Math.min(1,bc.a*la);
        base = base.c===null?{c:bc.c,a:ca,t:u.t===undefined?null:u.t}
                             :{c:blend(bc.c,ca,base.c),a:Math.min(1,ca+base.a*(1-ca)),t:u.t===undefined?null:u.t};
      }
      if(samples){
        samples.forEach(function(s){
          var sa=Math.min(1,s.a*la);
          next.push(base.c===null?{c:s.c,a:sa,t:s.t}
                                 :{c:blend(s.c,sa,base.c),a:Math.min(1,sa+base.a*(1-sa)),t:s.t});
        });
      } else next.push(base);
    });
    /* R10②/R11④：4096 上限仅为性能兜底；触发即标记 INDETERMINATE_SAMPLING_CAP，
       runner fail-closed，不再静默给确定结论 */
    if(next.length>4096){ markCapped(); return stride(next,4096); }
    return next;
  }

  /* ---------- 文字判定核心（组级 opacity + 覆盖像素采样） ---------- */
  function judgeFgMath(el,fg,ch){
    var elIdx=ch.nodes.length-1, gIdx=elIdx, i;
    for(i=elIdx;i>=0;i--){ if(ch.opEach[i]<1){ gIdx=i; break; } }   // 最内层 opacity 组
    var g=1; for(i=gIdx;i<ch.opEach.length;i++) g*=ch.opEach[i];
    /* R10②：采样与文字覆盖像素绑定（无硬上限），只检查覆盖区内的最差值 */
    var cov=coverageOf(el);
    var er=el.getBoundingClientRect(), eDocL=er.left-document.documentElement.getBoundingClientRect().left;
    var covW=(cov&&er.width>0)?Math.max(1,cov.maxX-cov.minX):Math.max(1,er.width||120);
    var width=Math.max(24,Math.round(covW));   // 每覆盖像素 1 样本，无上限
    var t0=0,t1=1;
    if(cov&&er.width>0){ t0=Math.max(0,(cov.minX-eDocL)/er.width); t1=Math.min(1,(cov.maxX-eDocL)/er.width); }
    var fgLum=lum(fg.c);
    function samplesFor(st){
      if(!st)return null;
      var smp=gradientSamples(st,width);
      /* 前景亮度交点：lum(c(t))=lum(fg) 的解析解并入 */
      var extra=[];
      for(var k=0;k<st.length-1;k++){
        var s1=st[k],s2=st[k+1];
        var l1=lum(s1.c),l2=lum(s2.c);
        if((l1-fgLum)*(l2-fgLum)>0||Math.abs(l1-l2)<1e-9)continue;
        var tt=s1.t+(fgLum-l1)/(l2-l1)*(s2.t-s1.t);
        if(tt>=s1.t&&tt<=s2.t)extra.push(tt);
      }
      if(extra.length){
        /* 重新生成含交点 t 的样本（在相邻采样点间插值出颜色/alpha） */
        var allT=smp.map(function(x){return x.t;}).concat(extra);
        allT.sort(function(a,b){return a-b;});
        smp=allT.map(function(tt){
          for(var k=0;k<smp.length-1;k++){ if(tt>=smp[k].t&&tt<=smp[k+1].t){ var u=(tt-smp[k].t)/(smp[k+1].t-smp[k].t||1);
            var a=smp[k].a*(1-u)+smp[k+1].a*u,c=[0,0,0];
            if(a>0){for(var j=0;j<3;j++)c[j]=((smp[k].c[j]*smp[k].a)*(1-u)+(smp[k+1].c[j]*smp[k+1].a)*u)/a;}
            return {c:c,a:a,t:tt}; } }
          return smp[smp.length-1];
        });
      }
      /* 只保留覆盖区内的样本 */
      var inCov=smp.filter(function(x){return x.t>=t0-1e-9&&x.t<=t1+1e-9;});
      return inCov.length?inCov:smp;
    }
    // 组内背景候选（G..el，css 域）
    var ib=[{c:null,a:0}];
    for(i=gIdx;i<=elIdx;i++){
      var csIn=getComputedStyle(ch.nodes[i]);
      var stIn=parseGradientStops(csIn.backgroundImage);
      ib=expandLayer(ib,csIn,1,stIn,stIn?samplesFor(stIn):null);
    }
    // 组外底色候选（0..gIdx-1 + page）
    var dl=[{c:pageBase(ch),a:1}];
    for(i=0;i<gIdx;i++){
      var csOut=getComputedStyle(ch.nodes[i]);
      var stOut=parseGradientStops(csOut.backgroundImage);
      dl=expandLayer(dl,csOut,layerAlpha(i,ch),stOut,stOut?samplesFor(stOut):null);
    }
    if(ib.length*dl.length>4096){ markCapped(); ib=stride(ib,64); dl=stride(dl,64); }
    var best=null;
    dl.forEach(function(Dent){
      var D=Dent.c;
      ib.forEach(function(b){
        var bOut,tOut;
        if(b.c===null){                                  // 组内透明：文字透出组外
          bOut=D;
          tOut=blend(fg.c,Math.min(1,fg.a*g),D);
        }else{
          bOut=blend(b.c,Math.min(1,b.a*g),D);
          var pIn=fg.a<1?blend(fg.c,fg.a,b.c):fg.c;      // 文字先在组内压同组背景
          tOut=blend(pIn,Math.min(1,g),D);               // 出组：整体乘 g 压 D
        }
        var r=ratio(tOut,bOut);
        var t=(b.t!==undefined&&b.t!==null)?b.t:(Dent.t!==undefined?Dent.t:null);
        if(!best||r<best.r)best={r:r,bg:bOut,eff:tOut,t:t};
      });
    });
    return best;
  }

  /* ---------- 定位描述 ---------- */
  function label(el){
    var n=el,path=[];
    while(n&&n.nodeType===1&&path.length<3){
      path.unshift(n.tagName.toLowerCase()+(n.classList.length?"."+n.classList[0]:"")+(n.id?"#"+n.id:""));
      n=n.parentElement;
    }
    return path.join("<");
  }
  function visible(el){
    var cs=getComputedStyle(el);
    if(cs.visibility==="hidden"||cs.display==="none")return false;
    if(parseFloat(cs.opacity)<0.05)return false;
    if(!el.offsetParent&&cs.position!=="fixed")return false;
    return true;
  }
  function txtPreview(el){
    try{if(el.tagName==="TEXTAREA")return "";}catch(e){}
    return (el.textContent||"").trim().slice(0,16);
  }
  function exemptInfo(el){
    var exEl=el.closest('[data-cx-exempt]');
    if(exEl)return exEl.getAttribute('data-cx-exempt');
    var disEl=el.closest(':disabled,[aria-disabled="true"]');
    if(disEl)return "disabled 控件（WCAG 1.4.3 豁免）";
    return null;
  }

  var FAILURES=[],CHECKED=0,EXEMPTED=[];
  /* R15①：可逆、无歧义结构编码（零写入）——JSON 元组树。
     每元素节点 = [tag, attrs, children]；attrs 仅收录语义/交互字段，键名排序：
       - 全部 aria-* 属性（attributes 集扫描，不再枚举式点名）
       - id / role / for / type / name / tabindex
       - class 规范化集合（split→排序→join）
       - 原生交互状态（property 为权威，属性缺省但 property 为真也收录）：
         hidden / disabled / readonly / required / open / checked / selected / inert
     JSON.stringify 转义一切值 → 不存在分隔符歧义（id="x|al=foo" 与
     id="x"+aria-label="foo" 编码必然不同）；JSON.parse 可逆。
     文本节点仅计数（tx）。输出 = JSON 串 + "#" + el:tx:spec:icon:roleN 计数。 */
  /* v16：语义/交互属性集——href/target/popover（链接与弹出层）、placeholder
     （占位符参与可访问性语义）；contenteditable 与 value 以 property 为权威在
     attrsOf 内条件编码（真值才编码，缺席即假，可逆）。 */
  var STRUCT_SEMANTIC={"id":1,"role":1,"for":1,"type":1,"name":1,
                       "href":1,"target":1,"popover":1,"placeholder":1};
  function structHash(){
    var el=0,tx=0,spec=0,icon=0,roleN=0;
    /* R15②：组合自反 chrome（[data-struct-chrome]，如侧栏 dir/theme/contrast 分段控件）
       的 aria-selected/tabindex 反映 URL 请求的组合身份，属 demo chrome 非卡片内容——
       规范化之，使跨组合等价类可比；chrome 的结构与其余属性仍在指纹内（结构变化照样捕获）。 */
    function attrsOf(e,inChrome){
      var raw={},k,v,i,attr;
      if(e.attributes){
        for(i=0;i<e.attributes.length;i++){
          attr=e.attributes[i]; k=attr.name;
          if(k.indexOf("aria-")===0||STRUCT_SEMANTIC[k]) raw[k]=attr.value;
        }
      }
      var cl=e.getAttribute&&e.getAttribute("class");
      if(cl){ var cs=String(cl).split(/\s+/).filter(Boolean).sort().join(" "); if(cs) raw["class"]=cs; }
      /* 原生交互状态：property 权威（mid-scan 状态翻转即时反映） */
      function b(key,val){ if(val!==undefined&&val!==null) raw[key]=val?"1":"0"; }
      b("hidden",e.hidden);
      if("disabled" in e) b("disabled",e.disabled);
      if("readOnly" in e) b("readonly",e.readOnly);
      if("required" in e) b("required",e.required);
      if("open" in e) b("open",e.open);
      if("checked" in e) b("checked",e.checked);
      if("selected" in e) b("selected",e.selected);
      if("inert" in e) b("inert",e.inert);
      var ti=e.getAttribute&&e.getAttribute("tabindex"); if(ti!==null) raw["tabindex"]=ti;
      /* v16：交互语义 property（真值才编码） */
      if(e.isContentEditable||e.getAttribute&&e.getAttribute("contenteditable")!==null)
        raw["contenteditable"]=e.isContentEditable?"1":String(e.getAttribute("contenteditable"));
      if("value" in e){
        var vv;
        try{ vv=e.value; }catch(_e){ vv=undefined; }
        if(typeof vv==="string"&&vv) raw["value"]=vv;
        else if(typeof vv==="number") raw["value"]=String(vv);
      }
      if(inChrome){ delete raw["aria-selected"]; delete raw["tabindex"]; }
      /* 键名稳定排序 → 插入序确定 → JSON 串确定 */
      var out={},keys=Object.keys(raw).sort();
      for(i=0;i<keys.length;i++) out[keys[i]]=raw[keys[i]];
      return out;
    }
    function build(n,d,inChrome){
      /* v16：取消 64 层静默截断——DOM 树有限，深层节点同样进指纹 */
      var out=[];
      for(var c=n.firstChild;c;c=c.nextSibling){
        if(c.nodeType===1){
          el++;
          if(c.classList&&c.classList.contains("spec"))spec++;
          if(c.classList&&c.classList.contains("icon-cell"))icon++;
          if(c.getAttribute&&c.getAttribute("role"))roleN++;
          var chrome=inChrome||(c.getAttribute&&c.hasAttribute("data-struct-chrome"));
          out.push([c.tagName.toLowerCase(),attrsOf(c,chrome),build(c,d+1,chrome)]);
        }
        else if(c.nodeType===3){ if(c.nodeValue.replace(/\s+/g,"")) tx++; }
      }
      return out;
    }
    var tree=build(document.documentElement,0,false);
    return JSON.stringify(tree)+"#"+el+":"+tx+":"+spec+":"+icon+":"+roleN;
  }
  /* 可逆性辅助：从结构串取 JSON 部分（最后一段 # 后是计数） */
  function structJsonOf(str){
    var i=str.lastIndexOf("#"); return i>=0?str.slice(0,i):str;
  }
  /* FNV-1a 64 位（双 32 半字）摘要——仅报告展示，判据是完整串比较 */
  function structFingerprint(str){
    var h1=0x811c9dc5,h2=0x811c9dc5^0x9e3779b9;
    for(var i=0;i<str.length;i++){ var c=str.charCodeAt(i);
      h1^=c; h1=(h1+((h1<<1)+(h1<<4)+(h1<<7)+(h1<<8)+(h1<<24)))>>>0;
      h2^=c+0x9e37; h2=(h2+((h2<<1)+(h2<<4)+(h2<<7)+(h2<<8)+(h2<<24)))>>>0; }
    return (h1>>>0).toString(16)+"."+(h2>>>0).toString(16)+"."+str.length;
  }
  /* R11④：采样裁剪触发标记——被裁剪即 INDETERMINATE，由 runner fail-closed */
  function markCapped(){ window.__samplingCapped=true; }

  /* ---------- 文本元素判定（text / probe 共用） ---------- */
  function judgeText(el){
    var cs=getComputedStyle(el);
    var fg=parseColor(cs.color);if(!fg)return null;
    var ch=chainOf(el);
    var best=judgeFgMath(el,fg,ch);
    var px=parseFloat(cs.fontSize),w=parseInt(cs.fontWeight,10)||400;
    var large=px>=24||(px>=18.66&&w>=700);
    var need=large?3.0:4.5;
    return {kind:"text",el:label(el),txt:txtPreview(el),
            px:+px.toFixed(1),sizeClass:large?"L":"S",
            ratio:+best.r.toFixed(2),need:need,
            fg:hexOf(best.eff),bg:hexOf(best.bg),t:best.t,
            _pass:best.r>=need,_exempt:exemptInfo(el)};
  }
  function record(rec){
    CHECKED++;
    if(rec._exempt){rec.reason=rec._exempt;EXEMPTED.push(rec);}
    else if(!rec._pass)FAILURES.push(rec);
  }

  function scanAll(){
    var seen=new Set(),nText=0,nVisible=0,nRec=0,nNull=0;
    /* 用元素遍历代替 TreeWalker（runner 环境 TreeWalker 递归异常） */
    var all=document.querySelectorAll('*');
    for(var qi=0;qi<all.length;qi++){
      var el=all[qi];
      /* 元素是否有直接文本 */
      var hasText=false;
      for(var ci=0;ci<el.childNodes.length;ci++){
        var cn=el.childNodes[ci];
        if(cn.nodeType===3&&cn.nodeValue.replace(/\s+/g,"")){ hasText=true; break; }
      }
      if(!hasText)continue;
      if(seen.has(el))continue; seen.add(el);
      nText++;
      var vis=visible(el), inSvg=!!el.closest("svg");
      if(!vis||inSvg) continue;
      nVisible++;
      try{ var rec=judgeText(el);if(rec){record(rec);nRec++;}else nNull++; }catch(e){ nNull++; window.__scanErr=(window.__scanErr||0)+1; }
    }
    ["::before","::after"].forEach(function(pseu){
      document.querySelectorAll("*").forEach(function(el){
        if(!visible(el))return;
        var cs=getComputedStyle(el,pseu);
        var content=cs.content;
        if(!content||content==="none"||content==="normal"||/attr\(|counter|url\(/.test(content))return;
        var text=content.replace(/^["']|["']$/g,"").replace(/\\"/g,'"');
        if(!text.trim())return;
        var fg=parseColor(cs.color);if(!fg)return;
        var ch=chainOf(el);
        var best=judgeFgMath(el,fg,ch);
        var px=parseFloat(cs.fontSize)||12;
        var need=px>=24?3:4.5;
        var rec={kind:"pseudo::"+pseu.slice(2),el:label(el),txt:text.slice(0,12),
                 px:+px.toFixed(1),sizeClass:px>=24?"L":"S",ratio:+best.r.toFixed(2),need:need,
                 fg:hexOf(best.eff),bg:hexOf(best.bg),
                 _pass:best.r>=need,_exempt:exemptInfo(el)};
        record(rec);
      });
    });
    document.querySelectorAll("input,textarea").forEach(function(el){
      var ph=el.getAttribute("placeholder");
      if(!ph&&!el.placeholder)return;
      if(!visible(el))return;
      var pcs=getComputedStyle(el,"::placeholder");
      var fg=parseColor(pcs.color);if(!fg)return;
      var ch=chainOf(el);
      var best=judgeFgMath(el,fg,ch);
      var cs=getComputedStyle(el);
      var rec={kind:"pseudo::placeholder",el:label(el),txt:ph||el.placeholder,
               px:+(parseFloat(cs.fontSize)||12).toFixed(1),sizeClass:"S",
               ratio:+best.r.toFixed(2),need:4.5,
               fg:hexOf(best.eff),bg:hexOf(best.bg),
               _pass:best.r>=4.5,_exempt:exemptInfo(el)};
      record(rec);
    });
  }

  /* ---------- 计数口径：DOM 权威 vs 侧栏标签 ---------- */
  function auditCounts(){
    var out={sections:[],totalSpecs:0,iconLibs:[]},ids=["cat-tokens","cat-basic","cat-icons","cat-input","cat-overlay","cat-data","cat-state","cat-sources","cat-artemis"];
    ids.forEach(function(id){
      var sec=document.getElementById(id);if(!sec)return;
      var actual=sec.querySelectorAll(".spec").length;
      var link=document.querySelector('nav a[href="#'+id+'"] .n');
      var claimed=link?parseInt(link.textContent,10):null;
      out.sections.push({id:id,actual:actual,sidebarLabel:claimed,match:claimed===actual});
    });
    out.totalSpecs=document.querySelectorAll(".spec").length;
    document.querySelectorAll(".icon-lib").forEach(function(g,i){
      out.iconLibs.push({grid:i+1,cells:g.querySelectorAll(".icon-cell").length});
    });
    return out;
  }

  window.ContrastScanner={
    run:function(labelStr){
      FAILURES=[];CHECKED=0;EXEMPTED=[];
      var scannerError=null,counts,html=document.documentElement;
      /* R13②/v14：run 幂等——先删除上次 run 遗留的 SCAN_OUT，再计算结构指纹，
         否则连续 run（如结构负向套件）会因累积输出节点而假报 structChanged */
      var oldOut=document.getElementById("SCAN_OUT"); if(oldOut) oldOut.remove();
      window.__samplingCapped=false;
      var structBefore=structHash();
      try{
        scanAll();
        counts=auditCounts();
      }catch(err){scannerError=((err&&err.stack)||String(err)).split(String.fromCharCode(10)).slice(0,2).join(" | ");counts=counts||{sections:[],totalSpecs:document.querySelectorAll(".spec").length,iconLibs:[]};}
      if(!counts)counts={sections:[],totalSpecs:0,iconLibs:[]};
      var structAfter=structHash();
      var mismatches=counts.sections.filter(function(s){return !s.match;});
      var nonce="";
      try{ nonce=new URLSearchParams(labelStr||"").get("n")||""; }catch(e){}
      var payload={
        meta:{label:labelStr||"",ua:navigator.userAgent,
              combo:{direction:html.getAttribute("data-direction"),theme:html.getAttribute("data-theme"),contrast:html.getAttribute("data-contrast")},
              generatedAt:new Date().toISOString(),scannerError:scannerError},
        /* 执行绑定证据：页面真实最终状态 + 请求 nonce（canonical 去重与行校验使用） */
        state:{direction:html.getAttribute("data-direction"),theme:html.getAttribute("data-theme"),
               contrast:html.getAttribute("data-contrast"),nonce:nonce},
        audit:{structBefore:structBefore,structAfter:structAfter,
               structFingerprint:structFingerprint(structBefore),
               structChanged:structBefore!==structAfter,samplingCapped:!!window.__samplingCapped,
               structEncoding:"json-tuple-v15"},
        summary:{checked:CHECKED,failures:FAILURES.length,countMismatches:mismatches.length,exempt:EXEMPTED.length},
        failures:FAILURES,exemptions:EXEMPTED,counts:counts,countMismatches:mismatches
      };
      var host=document.createElement("div");host.id="SCAN_OUT";
      host.setAttribute("data-ok",String(FAILURES.length===0&&mismatches.length===0&&!scannerError));
      host.setAttribute("data-json",encodeURIComponent(JSON.stringify(payload)));
      document.body.appendChild(host);
      return payload;
    },
    /* 结构串 JSON 部分提取（结构测试页可逆性断言用） */
    structJsonOf:structJsonOf,
    /* 单元素只算不记（fixtures 像素对照用） */
    probe:function(el){
      var keep={f:FAILURES.length,c:CHECKED,e:EXEMPTED.length};
      FAILURES=[];CHECKED=0;EXEMPTED=[];
      var rec=judgeText(el);
      FAILURES.length=keep.f;CHECKED=keep.c;EXEMPTED.length=keep.e;
      return rec;
    }
  };
})();
