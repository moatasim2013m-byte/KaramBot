< \/script>",e=e.removeChild(e.firstChild)):typeof r.is=="string"?e=i.createElement(n,{is:r.is}):(e=i.createElement(n),n==="select"&&(i=e,r.multiple?i.multiple=!0:r.size&&(i.size=r.size))):e=i.createElementNS(e,n),e[Ze]=t,e[ir]=r,Nc(e,t,!1,!1),t.stateNode=e;e:{switch(i=_a(n,r),n){case"dialog":$("cancel",e),$("close",e),l=r;break;case"iframe":case"object":case"embed":$("load",e),l=r;break;case"video":case"audio":for(l=0;l<Wn.length;l++)$(Wn[l],e);l=r;break;case"source":$("error",e),l=r;break;case"img":case"image":case"link":$("error",e),$("load",e),l=r;break;case"details":$("toggle",e),l=r;break;case"input":ji(e,r),l=Ia(e,r),$("invalid",e);break;case"option":l=r;break;case"select":e._wrapperState={wasMultiple:!!r.multiple},l=G({},r,{value:void 0}),$("invalid",e);break;case"textarea":Si(e,r),l=Fa(e,r),$("invalid",e);break;default:l=r}Da(n,l),o=l;for(a in o)if(o.hasOwnProperty(a)){var u=o[a];a==="style"?nu(e,u):a==="dangerouslySetInnerHTML"?(u=u?u.__html:void 0,u!=null&&eu(e,u)):a==="children"?typeof u=="string"?(n!=="textarea"||u!=="")&&Jn(e,u):typeof u=="number"&&Jn(e,""+u):a!=="suppressContentEditableWarning"&&a!=="suppressHydrationWarning"&&a!=="autoFocus"&&(Zn.hasOwnProperty(a)?u!=null&&a==="onScroll"&&$("scroll",e):u!=null&&As(e,a,u,i))}switch(n){case"input":Pr(e),Ni(e,r,!1);break;case"textarea":Pr(e),bi(e);break;case"option":r.value!=null&&e.setAttribute("value",""+bt(r.value));break;case"select":e.multiple=!!r.multiple,a=r.value,a!=null?dn(e,!!r.multiple,a,!1):r.defaultValue!=null&&dn(e,!!r.multiple,r.defaultValue,!0);break;default:typeof l.onClick=="function"&&(e.onclick=dl)}switch(n){case"button":case"input":case"select":case"textarea":r=!!r.autoFocus;break e;case"img":r=!0;break e;default:r=!1}}r&&(t.flags|=4)}t.ref!==null&&(t.flags|=512,t.flags|=2097152)}return de(t),null;case 6:if(e&&t.stateNode!=null)bc(e,t,e.memoizedProps,r);else{if(typeof r!="string"&&t.stateNode===null)throw Error(j(166));if(n=Dt(ur.current),Dt(Xe.current),_r(t)){if(r=t.stateNode,n=t.memoizedProps,r[Ze]=t,(a=r.nodeValue!==n)&&(e=be,e!==null))switch(e.tag){case 3:Dr(r.nodeValue,n,(e.mode&1)!==0);break;case 5:e.memoizedProps.suppressHydrationWarning!==!0&&Dr(r.nodeValue,n,(e.mode&1)!==0)}a&&(t.flags|=4)}else r=(n.nodeType===9?n:n.ownerDocument).createTextNode(r),r[Ze]=t,t.stateNode=r}return de(t),null;case 13:if(K(q),r=t.memoizedState,e===null||e.memoizedState!==null&&e.memoizedState.dehydrated!==null){if(Y&&Se!==null&&t.mode&1&&!(t.flags&128))Hu(),xn(),t.flags|=98560,a=!1;else if(a=_r(t),r!==null&&r.dehydrated!==null){if(e===null){if(!a)throw Error(j(318));if(a=t.memoizedState,a=a!==null?a.dehydrated:null,!a)throw Error(j(317));a[Ze]=t}else xn(),!(t.flags&128)&&(t.memoizedState=null),t.flags|=4;de(t),a=!1}else Oe!==null&&(vs(Oe),Oe=null),a=!0;if(!a)return t.flags&65536?t:null}return t.flags&128?(t.lanes=n,t):(r=r!==null,r!==(e!==null&&e.memoizedState!==null)&&r&&(t.child.flags|=8192,t.mode&1&&(e===null||q.current&1?ne===0&&(ne=3):ci())),t.updateQueue!==null&&(t.flags|=4),de(t),null);case 4:return wn(),cs(e,t),e===null&&ar(t.stateNode.containerInfo),de(t),null;case 10:return Ys(t.type._context),de(t),null;case 17:return we(t.type)&&fl(),de(t),null;case 19:if(K(q),a=t.memoizedState,a===null)return de(t),null;if(r=(t.flags&128)!==0,i=a.rendering,i===null)if(r)Fn(a,!1);else{if(ne!==0||e!==null&&e.flags&128)for(e=t.child;e!==null;){if(i=xl(e),i!==null){for(t.flags|=128,Fn(a,!1),r=i.updateQueue,r!==null&&(t.updateQueue=r,t.flags|=4),t.subtreeFlags=0,r=n,n=t.child;n!==null;)a=n,e=r,a.flags&=14680066,i=a.alternate,i===null?(a.childLanes=0,a.lanes=e,a.child=null,a.subtreeFlags=0,a.memoizedProps=null,a.memoizedState=null,a.updateQueue=null,a.dependencies=null,a.stateNode=null):(a.childLanes=i.childLanes,a.lanes=i.lanes,a.child=i.child,a.subtreeFlags=0,a.deletions=null,a.memoizedProps=i.memoizedProps,a.memoizedState=i.memoizedState,a.updateQueue=i.updateQueue,a.type=i.type,e=i.dependencies,a.dependencies=e===null?null:{lanes:e.lanes,firstContext:e.firstContext}),n=n.sibling;return H(q,q.current&1|2),t.child}e=e.sibling}a.tail!==null&&X()>Nn&&(t.flags|=128,r=!0,Fn(a,!1),t.lanes=4194304)}else{if(!r)if(e=xl(i),e!==null){if(t.flags|=128,r=!0,n=e.updateQueue,n!==null&&(t.updateQueue=n,t.flags|=4),Fn(a,!0),a.tail===null&&a.tailMode==="hidden"&&!i.alternate&&!Y)return de(t),null}else 2*X()-a.renderingStartTime>Nn&&n!==1073741824&&(t.flags|=128,r=!0,Fn(a,!1),t.lanes=4194304);a.isBackwards?(i.sibling=t.child,t.child=i):(n=a.last,n!==null?n.sibling=i:t.child=i,a.last=i)}return a.tail!==null?(t=a.tail,a.rendering=t,a.tail=t.sibling,a.renderingStartTime=X(),t.sibling=null,n=q.current,H(q,r?n&1|2:n&1),t):(de(t),null);case 22:case 23:return ui(),r=t.memoizedState!==null,e!==null&&e.memoizedState!==null!==r&&(t.flags|=8192),r&&t.mode&1?Ne&1073741824&&(de(t),t.subtreeFlags&6&&(t.flags|=8192)):de(t),null;case 24:return null;case 25:return null}throw Error(j(156,t.tag))}function ep(e,t){switch(Hs(t),t.tag){case 1:return we(t.type)&&fl(),e=t.flags,e&65536?(t.flags=e&-65537|128,t):null;case 3:return wn(),K(ke),K(pe),Js(),e=t.flags,e&65536&&!(e&128)?(t.flags=e&-65537|128,t):null;case 5:return Zs(t),null;case 13:if(K(q),e=t.memoizedState,e!==null&&e.dehydrated!==null){if(t.alternate===null)throw Error(j(340));xn()}return e=t.flags,e&65536?(t.flags=e&-65537|128,t):null;case 19:return K(q),null;case 4:return wn(),null;case 10:return Ys(t.type._context),null;case 22:case 23:return ui(),null;case 24:return null;default:return null}}var Wr=!1,fe=!1,tp=typeof WeakSet=="function"?WeakSet:Set,A=null;function un(e,t){var n=e.ref;if(n!==null)if(typeof n=="function")try{n(null)}catch(r){Z(e,t,r)}else n.current=null}function ds(e,t,n){try{n()}catch(r){Z(e,t,r)}}var ho=!1;function np(e,t){if(qa=ol,e=Tu(),Ws(e)){if("selectionStart"in e)var n={start:e.selectionStart,end:e.selectionEnd};else e:{n=(n=e.ownerDocument)&&n.defaultView||window;var r=n.getSelection&&n.getSelection();if(r&&r.rangeCount!==0){n=r.anchorNode;var l=r.anchorOffset,a=r.focusNode;r=r.focusOffset;try{n.nodeType,a.nodeType}catch{n=null;break e}var i=0,o=-1,u=-1,c=0,g=0,p=e,h=null;t:for(;;){for(var v;p!==n||l!==0&&p.nodeType!==3||(o=i+l),p!==a||r!==0&&p.nodeType!==3||(u=i+r),p.nodeType===3&&(i+=p.nodeValue.length),(v=p.firstChild)!==null;)h=p,p=v;for(;;){if(p===e)break t;if(h===n&&++c===l&&(o=i),h===a&&++g===r&&(u=i),(v=p.nextSibling)!==null)break;p=h,h=p.parentNode}p=v}n=o===-1||u===-1?null:{start:o,end:u}}else n=null}n=n||{start:0,end:0}}else n=null;for(Qa={focusedElem:e,selectionRange:n},ol=!1,A=t;A!==null;)if(t=A,e=t.child,(t.subtreeFlags&1028)!==0&&e!==null)e.return=t,A=e;else for(;A!==null;){t=A;try{var k=t.alternate;if(t.flags&1024)switch(t.tag){case 0:case 11:case 15:break;case 1:if(k!==null){var w=k.memoizedProps,_=k.memoizedState,f=t.stateNode,d=f.getSnapshotBeforeUpdate(t.elementType===t.type?w:_e(t.type,w),_);f.__reactInternalSnapshotBeforeUpdate=d}break;case 3:var m=t.stateNode.containerInfo;m.nodeType===1?m.textContent="":m.nodeType===9&&m.documentElement&&m.removeChild(m.documentElement);break;case 5:case 6:case 4:case 17:break;default:throw Error(j(163))}}catch(x){Z(t,t.return,x)}if(e=t.sibling,e!==null){e.return=t.return,A=e;break}A=t.return}return k=ho,ho=!1,k}function qn(e,t,n){var r=t.updateQueue;if(r=r!==null?r.lastEffect:null,r!==null){var l=r=r.next;do{if((l.tag&e)===e){var a=l.destroy;l.destroy=void 0,a!==void 0&&ds(t,n,a)}l=l.next}while(l!==r)}}function zl(e,t){if(t=t.updateQueue,t=t!==null?t.lastEffect:null,t!==null){var n=t=t.next;do{if((n.tag&e)===e){var r=n.create;n.destroy=r()}n=n.next}while(n!==t)}}function fs(e){var t=e.ref;if(t!==null){var n=e.stateNode;switch(e.tag){case 5:e=n;break;default:e=n}typeof t=="function"?t(e):t.current=e}}function Cc(e){var t=e.alternate;t!==null&&(e.alternate=null,Cc(t)),e.child=null,e.deletions=null,e.sibling=null,e.tag===5&&(t=e.stateNode,t!==null&&(delete t[Ze],delete t[ir],delete t[Ja],delete t[_f],delete t[Bf])),e.stateNode=null,e.return=null,e.dependencies=null,e.memoizedProps=null,e.memoizedState=null,e.pendingProps=null,e.stateNode=null,e.updateQueue=null}function Ec(e){return e.tag===5||e.tag===3||e.tag===4}function go(e){e:for(;;){for(;e.sibling===null;){if(e.return===null||Ec(e.return))return null;e=e.return}for(e.sibling.return=e.return,e=e.sibling;e.tag!==5&&e.tag!==6&&e.tag!==18;){if(e.flags&2||e.child===null||e.tag===4)continue e;e.child.return=e,e=e.child}if(!(e.flags&2))return e.stateNode}}function ps(e,t,n){var r=e.tag;if(r===5||r===6)e=e.stateNode,t?n.nodeType===8?n.parentNode.insertBefore(e,t):n.insertBefore(e,t):(n.nodeType===8?(t=n.parentNode,t.insertBefore(e,n)):(t=n,t.appendChild(e)),n=n._reactRootContainer,n!=null||t.onclick!==null||(t.onclick=dl));else if(r!==4&&(e=e.child,e!==null))for(ps(e,t,n),e=e.sibling;e!==null;)ps(e,t,n),e=e.sibling}function ms(e,t,n){var r=e.tag;if(r===5||r===6)e=e.stateNode,t?n.insertBefore(e,t):n.appendChild(e);else if(r!==4&&(e=e.child,e!==null))for(ms(e,t,n),e=e.sibling;e!==null;)ms(e,t,n),e=e.sibling}var ie=null,Be=!1;function ct(e,t,n){for(n=n.child;n!==null;)Ac(e,t,n),n=n.sibling}function Ac(e,t,n){if(Je&&typeof Je.onCommitFiberUnmount=="function")try{Je.onCommitFiberUnmount(Al,n)}catch{}switch(n.tag){case 5:fe||un(n,t);case 6:var r=ie,l=Be;ie=null,ct(e,t,n),ie=r,Be=l,ie!==null&&(Be?(e=ie,n=n.stateNode,e.nodeType===8?e.parentNode.removeChild(n):e.removeChild(n)):ie.removeChild(n.stateNode));break;case 18:ie!==null&&(Be?(e=ie,n=n.stateNode,e.nodeType===8?oa(e.parentNode,n):e.nodeType===1&&oa(e,n),nr(e)):oa(ie,n.stateNode));break;case 4:r=ie,l=Be,ie=n.stateNode.containerInfo,Be=!0,ct(e,t,n),ie=r,Be=l;break;case 0:case 11:case 14:case 15:if(!fe&&(r=n.updateQueue,r!==null&&(r=r.lastEffect,r!==null))){l=r=r.next;do{var a=l,i=a.destroy;a=a.tag,i!==void 0&&(a&2||a&4)&&ds(n,t,i),l=l.next}while(l!==r)}ct(e,t,n);break;case 1:if(!fe&&(un(n,t),r=n.stateNode,typeof r.componentWillUnmount=="function"))try{r.props=n.memoizedProps,r.state=n.memoizedState,r.componentWillUnmount()}catch(o){Z(n,t,o)}ct(e,t,n);break;case 21:ct(e,t,n);break;case 22:n.mode&1?(fe=(r=fe)||n.memoizedState!==null,ct(e,t,n),fe=r):ct(e,t,n);break;default:ct(e,t,n)}}function yo(e){var t=e.updateQueue;if(t!==null){e.updateQueue=null;var n=e.stateNode;n===null&&(n=e.stateNode=new tp),t.forEach(function(r){var l=dp.bind(null,e,r);n.has(r)||(n.add(r),r.then(l,l))})}}function De(e,t){var n=t.deletions;if(n!==null)for(var r=0;r<n.length;r++){var l=n[r];try{var a=e,i=t,o=i;e:for(;o!==null;){switch(o.tag){case 5:ie=o.stateNode,Be=!1;break e;case 3:ie=o.stateNode.containerInfo,Be=!0;break e;case 4:ie=o.stateNode.containerInfo,Be=!0;break e}o=o.return}if(ie===null)throw Error(j(160));Ac(a,i,l),ie=null,Be=!1;var u=l.alternate;u!==null&&(u.return=null),l.return=null}catch(c){Z(l,t,c)}}if(t.subtreeFlags&12854)for(t=t.child;t!==null;)Pc(t,e),t=t.sibling}function Pc(e,t){var n=e.alternate,r=e.flags;switch(e.tag){case 0:case 11:case 14:case 15:if(De(t,e),Qe(e),r&4){try{qn(3,e,e.return),zl(3,e)}catch(w){Z(e,e.return,w)}try{qn(5,e,e.return)}catch(w){Z(e,e.return,w)}}break;case 1:De(t,e),Qe(e),r&512&&n!==null&&un(n,n.return);break;case 5:if(De(t,e),Qe(e),r&512&&n!==null&&un(n,n.return),e.flags&32){var l=e.stateNode;try{Jn(l,"")}catch(w){Z(e,e.return,w)}}if(r&4&&(l=e.stateNode,l!=null)){var a=e.memoizedProps,i=n!==null?n.memoizedProps:a,o=e.type,u=e.updateQueue;if(e.updateQueue=null,u!==null)try{o==="input"&&a.type==="radio"&&a.name!=null&&Zo(l,a),_a(o,i);var c=_a(o,a);for(i=0;i<u.length;i+=2){var g=u[i],p=u[i+1];g==="style"?nu(l,p):g==="dangerouslySetInnerHTML"?eu(l,p):g==="children"?Jn(l,p):As(l,g,p,c)}switch(o){case"input":La(l,a);break;case"textarea":Jo(l,a);break;case"select":var h=l._wrapperState.wasMultiple;l._wrapperState.wasMultiple=!!a.multiple;var v=a.value;v!=null?dn(l,!!a.multiple,v,!1):h!==!!a.multiple&&(a.defaultValue!=null?dn(l,!!a.multiple,a.defaultValue,!0):dn(l,!!a.multiple,a.multiple?[]:"",!1))}l[ir]=a}catch(w){Z(e,e.return,w)}}break;case 6:if(De(t,e),Qe(e),r&4){if(e.stateNode===null)throw Error(j(162));l=e.stateNode,a=e.memoizedProps;try{l.nodeValue=a}catch(w){Z(e,e.return,w)}}break;case 3:if(De(t,e),Qe(e),r&4&&n!==null&&n.memoizedState.isDehydrated)try{nr(t.containerInfo)}catch(w){Z(e,e.return,w)}break;case 4:De(t,e),Qe(e);break;case 13:De(t,e),Qe(e),l=e.child,l.flags&8192&&(a=l.memoizedState!==null,l.stateNode.isHidden=a,!a||l.alternate!==null&&l.alternate.memoizedState!==null||(ii=X())),r&4&&yo(e);break;case 22:if(g=n!==null&&n.memoizedState!==null,e.mode&1?(fe=(c=fe)||g,De(t,e),fe=c):De(t,e),Qe(e),r&8192){if(c=e.memoizedState!==null,(e.stateNode.isHidden=c)&&!g&&e.mode&1)for(A=e,g=e.child;g!==null;){for(p=A=g;A!==null;){switch(h=A,v=h.child,h.tag){case 0:case 11:case 14:case 15:qn(4,h,h.return);break;case 1:un(h,h.return);var k=h.stateNode;if(typeof k.componentWillUnmount=="function"){r=h,n=h.return;try{t=r,k.props=t.memoizedProps,k.state=t.memoizedState,k.componentWillUnmount()}catch(w){Z(r,n,w)}}break;case 5:un(h,h.return);break;case 22:if(h.memoizedState!==null){xo(p);continue}}v!==null?(v.return=h,A=v):xo(p)}g=g.sibling}e:for(g=null,p=e;;){if(p.tag===5){if(g===null){g=p;try{l=p.stateNode,c?(a=l.style,typeof a.setProperty=="function"?a.setProperty("display","none","important"):a.display="none"):(o=p.stateNode,u=p.memoizedProps.style,i=u!=null&&u.hasOwnProperty("display")?u.display:null,o.style.display=tu("display",i))}catch(w){Z(e,e.return,w)}}}else if(p.tag===6){if(g===null)try{p.stateNode.nodeValue=c?"":p.memoizedProps}catch(w){Z(e,e.return,w)}}else if((p.tag!==22&&p.tag!==23||p.memoizedState===null||p===e)&&p.child!==null){p.child.return=p,p=p.child;continue}if(p===e)break e;for(;p.sibling===null;){if(p.return===null||p.return===e)break e;g===p&&(g=null),p=p.return}g===p&&(g=null),p.sibling.return=p.return,p=p.sibling}}break;case 19:De(t,e),Qe(e),r&4&&yo(e);break;case 21:break;default:De(t,e),Qe(e)}}function Qe(e){var t=e.flags;if(t&2){try{e:{for(var n=e.return;n!==null;){if(Ec(n)){var r=n;break e}n=n.return}throw Error(j(160))}switch(r.tag){case 5:var l=r.stateNode;r.flags&32&&(Jn(l,""),r.flags&=-33);var a=go(e);ms(e,a,l);break;case 3:case 4:var i=r.stateNode.containerInfo,o=go(e);ps(e,o,i);break;default:throw Error(j(161))}}catch(u){Z(e,e.return,u)}e.flags&=-3}t&4096&&(e.flags&=-4097)}function rp(e,t,n){A=e,Tc(e)}function Tc(e,t,n){for(var r=(e.mode&1)!==0;A!==null;){var l=A,a=l.child;if(l.tag===22&&r){var i=l.memoizedState!==null||Wr;if(!i){var o=l.alternate,u=o!==null&&o.memoizedState!==null||fe;o=Wr;var c=fe;if(Wr=i,(fe=u)&&!c)for(A=l;A!==null;)i=A,u=i.child,i.tag===22&&i.memoizedState!==null?ko(l):u!==null?(u.return=i,A=u):ko(l);for(;a!==null;)A=a,Tc(a),a=a.sibling;A=l,Wr=o,fe=c}vo(e)}else l.subtreeFlags&8772&&a!==null?(a.return=l,A=a):vo(e)}}function vo(e){for(;A!==null;){var t=A;if(t.flags&8772){var n=t.alternate;try{if(t.flags&8772)switch(t.tag){case 0:case 11:case 15:fe||zl(5,t);break;case 1:var r=t.stateNode;if(t.flags&4&&!fe)if(n===null)r.componentDidMount();else{var l=t.elementType===t.type?n.memoizedProps:_e(t.type,n.memoizedProps);r.componentDidUpdate(l,n.memoizedState,r.__reactInternalSnapshotBeforeUpdate)}var a=t.updateQueue;a!==null&&to(t,a,r);break;case 3:var i=t.updateQueue;if(i!==null){if(n=null,t.child!==null)switch(t.child.tag){case 5:n=t.child.stateNode;break;case 1:n=t.child.stateNode}to(t,i,n)}break;case 5:var o=t.stateNode;if(n===null&&t.flags&4){n=o;var u=t.memoizedProps;switch(t.type){case"button":case"input":case"select":case"textarea":u.autoFocus&&n.focus();break;case"img":u.src&&(n.src=u.src)}}break;case 6:break;case 4:break;case 12:break;case 13:if(t.memoizedState===null){var c=t.alternate;if(c!==null){var g=c.memoizedState;if(g!==null){var p=g.dehydrated;p!==null&&nr(p)}}}break;case 19:case 17:case 21:case 22:case 23:case 25:break;default:throw Error(j(163))}fe||t.flags&512&&fs(t)}catch(h){Z(t,t.return,h)}}if(t===e){A=null;break}if(n=t.sibling,n!==null){n.return=t.return,A=n;break}A=t.return}}function xo(e){for(;A!==null;){var t=A;if(t===e){A=null;break}var n=t.sibling;if(n!==null){n.return=t.return,A=n;break}A=t.return}}function ko(e){for(;A!==null;){var t=A;try{switch(t.tag){case 0:case 11:case 15:var n=t.return;try{zl(4,t)}catch(u){Z(t,n,u)}break;case 1:var r=t.stateNode;if(typeof r.componentDidMount=="function"){var l=t.return;try{r.componentDidMount()}catch(u){Z(t,l,u)}}var a=t.return;try{fs(t)}catch(u){Z(t,a,u)}break;case 5:var i=t.return;try{fs(t)}catch(u){Z(t,i,u)}}}catch(u){Z(t,t.return,u)}if(t===e){A=null;break}var o=t.sibling;if(o!==null){o.return=t.return,A=o;break}A=t.return}}var lp=Math.ceil,jl=ut.ReactCurrentDispatcher,ai=ut.ReactCurrentOwner,Le=ut.ReactCurrentBatchConfig,O=0,se=null,ee=null,oe=0,Ne=0,cn=At(0),ne=0,pr=null,Vt=0,Dl=0,si=0,Qn=null,ve=null,ii=0,Nn=1/
0, et = null, Nl = !1, hs = null, jt = null, Ur = !1, gt = null, Sl = 0, Gn = 0, gs = null, el = -1, tl = 0;

function he() {
  return O & 6 ? X() : el !== -1 ? el : el = X()
}

function Nt(e) {
  return e.mode & 1 ? O & 2 && oe !== 0 ? oe & -oe : Wf.transition !== null ? (tl === 0 && (tl = mu()), tl) : (e = U, e !== 0 || (e = window.event, e = e === void 0 ? 16 : wu(e.type)), e) : 1
}

function Ue(e, t, n, r) {
  if (50 < Gn) throw Gn = 0, gs = null, Error(j(185));
  xr(e, n, r), (!(O & 2) || e !== se) && (e === se && (!(O & 2) && (Dl |= n), ne === 4 && mt(e, oe)), je(e, r), n === 1 && O === 0 && !(t.mode & 1) && (Nn = X() + 500, Ll && Pt()))
}

function je(e, t) {
  var n = e.callbackNode;
  Od(e, t);
  var r = il(e, e === se ? oe : 0);
  if (r === 0) n !== null && Ai(n), e.callbackNode = null, e.callbackPriority = 0;
  else if (t = r & -r, e.callbackPriority !== t) {
    if (n != null && Ai(n), t === 1) e.tag === 0 ? Of(wo.bind(null, e)) : Ou(wo.bind(null, e)), zf(function() {
      !(O & 6) && Pt()
    }), n = null;
    else {
      switch (hu(r)) {
        case 1:
          n = Ls;
          break;
        case 4:
          n = fu;
          break;
        case 16:
          n = sl;
          break;
        case 536870912:
          n = pu;
          break;
        default:
          n = sl
      }
      n = _c(n, Mc.bind(null, e))
    }
    e.callbackPriority = t, e.callbackNode = n
  }
}

function Mc(e, t) {
  if (el = -1, tl = 0, O & 6) throw Error(j(327));
  var n = e.callbackNode;
  if (gn() && e.callbackNode !== n) return null;
  var r = il(e, e === se ? oe : 0);
  if (r === 0) return null;
  if (r & 30 || r & e.expiredLanes || t) t = bl(e, r);
  else {
    t = r;
    var l = O;
    O |= 2;
    var a = Lc();
    (se !== e || oe !== t) && (et = null, Nn = X() + 500, Bt(e, t));
    do try {
      ip();
      break
    } catch (o) {
      Ic(e, o)
    }
    while (!0);
    Ks(), jl.current = a, O = l, ee !== null ? t = 0 : (se = null, oe = 0, t = ne)
  }
  if (t !== 0) {
    if (t === 2 && (l = Ha(e), l !== 0 && (r = l, t = ys(e, l))), t === 1) throw n = pr, Bt(e, 0), mt(e, r), je(e, X()), n;
    if (t === 6) mt(e, r);
    else {
      if (l = e.current.alternate, !(r & 30) && !ap(l) && (t = bl(e, r), t === 2 && (a = Ha(e), a !== 0 && (r = a, t = ys(e, a))), t === 1)) throw n = pr, Bt(e, 0), mt(e, r), je(e, X()), n;
      switch (e.finishedWork = l, e.finishedLanes = r, t) {
        case 0:
        case 1:
          throw Error(j(345));
        case 2:
          Rt(e, ve, et);
          break;
        case 3:
          if (mt(e, r), (r & 130023424) === r && (t = ii + 500 - X(), 10 < t)) {
            if (il(e, 0) !== 0) break;
            if (l = e.suspendedLanes, (l & r) !== r) {
              he(), e.pingedLanes |= e.suspendedLanes & l;
              break
            }
            e.timeoutHandle = Za(Rt.bind(null, e, ve, et), t);
            break
          }
          Rt(e, ve, et);
          break;
        case 4:
          if (mt(e, r), (r & 4194240) === r) break;
          for (t = e.eventTimes, l = -1; 0 < r;) {
            var i = 31 - We(r);
            a = 1 << i, i = t[i], i > l && (l = i), r &= ~a
          }
          if (r = l, r = X() - r, r = (120 > r ? 120 : 480 > r ? 480 : 1080 > r ? 1080 : 1920 > r ? 1920 : 3e3 > r ? 3e3 : 4320 > r ? 4320 : 1960 * lp(r / 1960)) - r, 10 < r) {
            e.timeoutHandle = Za(Rt.bind(null, e, ve, et), r);
            break
          }
          Rt(e, ve, et);
          break;
        case 5:
          Rt(e, ve, et);
          break;
        default:
          throw Error(j(329))
      }
    }
  }
  return je(e, X()), e.callbackNode === n ? Mc.bind(null, e) : null
}

function ys(e, t) {
  var n = Qn;
  return e.current.memoizedState.isDehydrated && (Bt(e, t).flags |= 256), e = bl(e, t), e !== 2 && (t = ve, ve = n, t !== null && vs(t)), e
}

function vs(e) {
  ve === null ? ve = e : ve.push.apply(ve, e)
}

function ap(e) {
  for (var t = e;;) {
    if (t.flags & 16384) {
      var n = t.updateQueue;
      if (n !== null && (n = n.stores, n !== null))
        for (var r = 0; r < n.length; r++) {
          var l = n[r],
            a = l.getSnapshot;
          l = l.value;
          try {
            if (!Ve(a(), l)) return !1
          } catch {
            return !1
          }
        }
    }
    if (n = t.child, t.subtreeFlags & 16384 && n !== null) n.return = t, t = n;
    else {
      if (t === e) break;
      for (; t.sibling === null;) {
        if (t.return === null || t.return === e) return !0;
        t = t.return
      }
      t.sibling.return = t.return, t = t.sibling
    }
  }
  return !0
}

function mt(e, t) {
  for (t &= ~si, t &= ~Dl, e.suspendedLanes |= t, e.pingedLanes &= ~t, e = e.expirationTimes; 0 < t;) {
    var n = 31 - We(t),
      r = 1 << n;
    e[n] = -1, t &= ~r
  }
}

function wo(e) {
  if (O & 6) throw Error(j(327));
  gn();
  var t = il(e, 0);
  if (!(t & 1)) return je(e, X()), null;
  var n = bl(e, t);
  if (e.tag !== 0 && n === 2) {
    var r = Ha(e);
    r !== 0 && (t = r, n = ys(e, r))
  }
  if (n === 1) throw n = pr, Bt(e, 0), mt(e, t), je(e, X()), n;
  if (n === 6) throw Error(j(345));
  return e.finishedWork = e.current.alternate, e.finishedLanes = t, Rt(e, ve, et), je(e, X()), null
}

function oi(e, t) {
  var n = O;
  O |= 1;
  try {
    return e(t)
  } finally {
    O = n, O === 0 && (Nn = X() + 500, Ll && Pt())
  }
}

function $t(e) {
  gt !== null && gt.tag === 0 && !(O & 6) && gn();
  var t = O;
  O |= 1;
  var n = Le.transition,
    r = U;
  try {
    if (Le.transition = null, U = 1, e) return e()
  } finally {
    U = r, Le.transition = n, O = t, !(O & 6) && Pt()
  }
}

function ui() {
  Ne = cn.current, K(cn)
}

function Bt(e, t) {
  e.finishedWork = null, e.finishedLanes = 0;
  var n = e.timeoutHandle;
  if (n !== -1 && (e.timeoutHandle = -1, Ff(n)), ee !== null)
    for (n = ee.return; n !== null;) {
      var r = n;
      switch (Hs(r), r.tag) {
        case 1:
          r = r.type.childContextTypes, r != null && fl();
          break;
        case 3:
          wn(), K(ke), K(pe), Js();
          break;
        case 5:
          Zs(r);
          break;
        case 4:
          wn();
          break;
        case 13:
          K(q);
          break;
        case 19:
          K(q);
          break;
        case 10:
          Ys(r.type._context);
          break;
        case 22:
        case 23:
          ui()
      }
      n = n.return
    }
  if (se = e, ee = e = St(e.current, null), oe = Ne = t, ne = 0, pr = null, si = Dl = Vt = 0, ve = Qn = null, zt !== null) {
    for (t = 0; t < zt.length; t++)
      if (n = zt[t], r = n.interleaved, r !== null) {
        n.interleaved = null;
        var l = r.next,
          a = n.pending;
        if (a !== null) {
          var i = a.next;
          a.next = l, r.next = i
        }
        n.pending = r
      } zt = null
  }
  return e
}

function Ic(e, t) {
  do {
    var n = ee;
    try {
      if (Ks(), Zr.current = wl, kl) {
        for (var r = Q.memoizedState; r !== null;) {
          var l = r.queue;
          l !== null && (l.pending = null), r = r.next
        }
        kl = !1
      }
      if (Ht = 0, ae = te = Q = null, Yn = !1, cr = 0, ai.current = null, n === null || n.return === null) {
        ne = 1, pr = t, ee = null;
        break
      }
      e: {
        var a = e,
          i = n.return,
          o = n,
          u = t;
        if (t = oe, o.flags |= 32768, u !== null && typeof u == "object" && typeof u.then == "function") {
          var c = u,
            g = o,
            p = g.tag;
          if (!(g.mode & 1) && (p === 0 || p === 11 || p === 15)) {
            var h = g.alternate;
            h ? (g.updateQueue = h.updateQueue, g.memoizedState = h.memoizedState, g.lanes = h.lanes) : (g.updateQueue = null, g.memoizedState = null)
          }
          var v = io(i);
          if (v !== null) {
            v.flags &= -257, oo(v, i, o, a, t), v.mode & 1 && so(a, c, t), t = v, u = c;
            var k = t.updateQueue;
            if (k === null) {
              var w = new Set;
              w.add(u), t.updateQueue = w
            } else k.add(u);
            break e
          } else {
            if (!(t & 1)) {
              so(a, c, t), ci();
              break e
            }
            u = Error(j(426))
          }
        } else if (Y && o.mode & 1) {
          var _ = io(i);
          if (_ !== null) {
            !(_.flags & 65536) && (_.flags |= 256), oo(_, i, o, a, t), Vs(jn(u, o));
            break e
          }
        }
        a = u = jn(u, o),
        ne !== 4 && (ne = 2),
        Qn === null ? Qn = [a] : Qn.push(a),
        a = i;do {
          switch (a.tag) {
            case 3:
              a.flags |= 65536, t &= -t, a.lanes |= t;
              var f = hc(a, u, t);
              eo(a, f);
              break e;
            case 1:
              o = u;
              var d = a.type,
                m = a.stateNode;
              if (!(a.flags & 128) && (typeof d.getDerivedStateFromError == "function" || m !== null && typeof m.componentDidCatch == "function" && (jt === null || !jt.has(m)))) {
                a.flags |= 65536, t &= -t, a.lanes |= t;
                var x = gc(a, o, t);
                eo(a, x);
                break e
              }
          }
          a = a.return
        } while (a !== null)
      }
      Fc(n)
    } catch (S) {
      t = S, ee === n && n !== null && (ee = n = n.return);
      continue
    }
    break
  } while (!0)
}

function Lc() {
  var e = jl.current;
  return jl.current = wl, e === null ? wl : e
}

function ci() {
  (ne === 0 || ne === 3 || ne === 2) && (ne = 4), se === null || !(Vt & 268435455) && !(Dl & 268435455) || mt(se, oe)
}

function bl(e, t) {
  var n = O;
  O |= 2;
  var r = Lc();
  (se !== e || oe !== t) && (et = null, Bt(e, t));
  do try {
    sp();
    break
  } catch (l) {
    Ic(e, l)
  }
  while (!0);
  if (Ks(), O = n, jl.current = r, ee !== null) throw Error(j(261));
  return se = null, oe = 0, ne
}

function sp() {
  for (; ee !== null;) Rc(ee)
}

function ip() {
  for (; ee !== null && !Md();) Rc(ee)
}

function Rc(e) {
  var t = Dc(e.alternate, e, Ne);
  e.memoizedProps = e.pendingProps, t === null ? Fc(e) : ee = t, ai.current = null
}

function Fc(e) {
  var t = e;
  do {
    var n = t.alternate;
    if (e = t.return, t.flags & 32768) {
      if (n = ep(n, t), n !== null) {
        n.flags &= 32767, ee = n;
        return
      }
      if (e !== null) e.flags |= 32768, e.subtreeFlags = 0, e.deletions = null;
      else {
        ne = 6, ee = null;
        return
      }
    } else if (n = Xf(n, t, Ne), n !== null) {
      ee = n;
      return
    }
    if (t = t.sibling, t !== null) {
      ee = t;
      return
    }
    ee = t = e
  } while (t !== null);
  ne === 0 && (ne = 5)
}

function Rt(e, t, n) {
  var r = U,
    l = Le.transition;
  try {
    Le.transition = null, U = 1, op(e, t, n, r)
  } finally {
    Le.transition = l, U = r
  }
  return null
}

function op(e, t, n, r) {
  do gn(); while (gt !== null);
  if (O & 6) throw Error(j(327));
  n = e.finishedWork;
  var l = e.finishedLanes;
  if (n === null) return null;
  if (e.finishedWork = null, e.finishedLanes = 0, n === e.current) throw Error(j(177));
  e.callbackNode = null, e.callbackPriority = 0;
  var a = n.lanes | n.childLanes;
  if (Wd(e, a), e === se && (ee = se = null, oe = 0), !(n.subtreeFlags & 2064) && !(n.flags & 2064) || Ur || (Ur = !0, _c(sl, function() {
      return gn(), null
    })), a = (n.flags & 15990) !== 0, n.subtreeFlags & 15990 || a) {
    a = Le.transition, Le.transition = null;
    var i = U;
    U = 1;
    var o = O;
    O |= 4, ai.current = null, np(e, n), Pc(n, e), Af(Qa), ol = !!qa, Qa = qa = null, e.current = n, rp(n), Id(), O = o, U = i, Le.transition = a
  } else e.current = n;
  if (Ur && (Ur = !1, gt = e, Sl = l), a = e.pendingLanes, a === 0 && (jt = null), Fd(n.stateNode), je(e, X()), t !== null)
    for (r = e.onRecoverableError, n = 0; n < t.length; n++) l = t[n], r(l.value, {
      componentStack: l.stack,
      digest: l.digest
    });
  if (Nl) throw Nl = !1, e = hs, hs = null, e;
  return Sl & 1 && e.tag !== 0 && gn(), a = e.pendingLanes, a & 1 ? e === gs ? Gn++ : (Gn = 0, gs = e) : Gn = 0, Pt(), null
}

function gn() {
  if (gt !== null) {
    var e = hu(Sl),
      t = Le.transition,
      n = U;
    try {
      if (Le.transition = null, U = 16 > e ? 16 : e, gt === null) var r = !1;
      else {
        if (e = gt, gt = null, Sl = 0, O & 6) throw Error(j(331));
        var l = O;
        for (O |= 4, A = e.current; A !== null;) {
          var a = A,
            i = a.child;
          if (A.flags & 16) {
            var o = a.deletions;
            if (o !== null) {
              for (var u = 0; u < o.length; u++) {
                var c = o[u];
                for (A = c; A !== null;) {
                  var g = A;
                  switch (g.tag) {
                    case 0:
                    case 11:
                    case 15:
                      qn(8, g, a)
                  }
                  var p = g.child;
                  if (p !== null) p.return = g, A = p;
                  else
                    for (; A !== null;) {
                      g = A;
                      var h = g.sibling,
                        v = g.return;
                      if (Cc(g), g === c) {
                        A = null;
                        break
                      }
                      if (h !== null) {
                        h.return = v, A = h;
                        break
                      }
                      A = v
                    }
                }
              }
              var k = a.alternate;
              if (k !== null) {
                var w = k.child;
                if (w !== null) {
                  k.child = null;
                  do {
                    var _ = w.sibling;
                    w.sibling = null, w = _
                  } while (w !== null)
                }
              }
              A = a
            }
          }
          if (a.subtreeFlags & 2064 && i !== null) i.return = a, A = i;
          else e: for (; A !== null;) {
            if (a = A, a.flags & 2048) switch (a.tag) {
              case 0:
              case 11:
              case 15:
                qn(9, a, a.return)
            }
            var f = a.sibling;
            if (f !== null) {
              f.return = a.return, A = f;
              break e
            }
            A = a.return
          }
        }
        var d = e.current;
        for (A = d; A !== null;) {
          i = A;
          var m = i.child;
          if (i.subtreeFlags & 2064 && m !== null) m.return = i, A = m;
          else e: for (i = d; A !== null;) {
            if (o = A, o.flags & 2048) try {
              switch (o.tag) {
                case 0:
                case 11:
                case 15:
                  zl(9, o)
              }
            } catch (S) {
              Z(o, o.return, S)
            }
            if (o === i) {
              A = null;
              break e
            }
            var x = o.sibling;
            if (x !== null) {
              x.return = o.return, A = x;
              break e
            }
            A = o.return
          }
        }
        if (O = l, Pt(), Je && typeof Je.onPostCommitFiberRoot == "function") try {
          Je.onPostCommitFiberRoot(Al, e)
        } catch {}
        r = !0
      }
      return r
    } finally {
      U = n, Le.transition = t
    }
  }
  return !1
}

function jo(e, t, n) {
  t = jn(n, t), t = hc(e, t, 1), e = wt(e, t, 1), t = he(), e !== null && (xr(e, 1, t), je(e, t))
}

function Z(e, t, n) {
  if (e.tag === 3) jo(e, e, n);
  else
    for (; t !== null;) {
      if (t.tag === 3) {
        jo(t, e, n);
        break
      } else if (t.tag === 1) {
        var r = t.stateNode;
        if (typeof t.type.getDerivedStateFromError == "function" || typeof r.componentDidCatch == "function" && (jt === null || !jt.has(r))) {
          e = jn(n, e), e = gc(t, e, 1), t = wt(t, e, 1), e = he(), t !== null && (xr(t, 1, e), je(t, e));
          break
        }
      }
      t = t.return
    }
}

function up(e, t, n) {
  var r = e.pingCache;
  r !== null && r.delete(t), t = he(), e.pingedLanes |= e.suspendedLanes & n, se === e && (oe & n) === n && (ne === 4 || ne === 3 && (oe & 130023424) === oe && 500 > X() - ii ? Bt(e, 0) : si |= n), je(e, t)
}

function zc(e, t) {
  t === 0 && (e.mode & 1 ? (t = Ir, Ir <<= 1, !(Ir & 130023424) && (Ir = 4194304)) : t = 1);
  var n = he();
  e = it(e, t), e !== null && (xr(e, t, n), je(e, n))
}

function cp(e) {
  var t = e.memoizedState,
    n = 0;
  t !== null && (n = t.retryLane), zc(e, n)
}

function dp(e, t) {
  var n = 0;
  switch (e.tag) {
    case 13:
      var r = e.stateNode,
        l = e.memoizedState;
      l !== null && (n = l.retryLane);
      break;
    case 19:
      r = e.stateNode;
      break;
    default:
      throw Error(j(314))
  }
  r !== null && r.delete(t), zc(e, n)
}
var Dc;
Dc = function(e, t, n) {
  if (e !== null)
    if (e.memoizedProps !== t.pendingProps || ke.current) xe = !0;
    else {
      if (!(e.lanes & n) && !(t.flags & 128)) return xe = !1, Jf(e, t, n);
      xe = !!(e.flags & 131072)
    }
  else xe = !1, Y && t.flags & 1048576 && Wu(t, hl, t.index);
  switch (t.lanes = 0, t.tag) {
    case 2:
      var r = t.type;
      Xr(e, t), e = t.pendingProps;
      var l = vn(t, pe.current);
      hn(t, n), l = ei(null, t, r, e, l, n);
      var a = ti();
      return t.flags |= 1, typeof l == "object" && l !== null && typeof l.render == "function" && l.$$typeof === void 0 ? (t.tag = 1, t.memoizedState = null, t.updateQueue = null, we(r) ? (a = !0, pl(t)) : a = !1, t.memoizedState = l.state !== null && l.state !== void 0 ? l.state : null, Qs(t), l.updater = Fl, t.stateNode = l, l._reactInternals = t, ls(t, r, e, n), t = is(null, t, r, !0, a, n)) : (t.tag = 0, Y && a && Us(t), me(null, t, l, n), t = t.child), t;
    case 16:
      r = t.elementType;
      e: {
        switch (Xr(e, t), e = t.pendingProps, l = r._init, r = l(r._payload), t.type = r, l = t.tag = pp(r), e = _e(r, e), l) {
          case 0:
            t = ss(null, t, r, e, n);
            break e;
          case 1:
            t = fo(null, t, r, e, n);
            break e;
          case 11:
            t = uo(null, t, r, e, n);
            break e;
          case 14:
            t = co(null, t, r, _e(r.type, e), n);
            break e
        }
        throw Error(j(306, r, ""))
      }
      return t;
    case 0:
      return r = t.type, l = t.pendingProps, l = t.elementType === r ? l : _e(r, l), ss(e, t, r, l, n);
    case 1:
      return r = t.type, l = t.pendingProps, l = t.elementType === r ? l : _e(r, l), fo(e, t, r, l, n);
    case 3:
      e: {
        if (kc(t), e === null) throw Error(j(387));r = t.pendingProps,
        a = t.memoizedState,
        l = a.element,
        Yu(e, t),
        vl(t, r, null, n);
        var i = t.memoizedState;
        if (r = i.element, a.isDehydrated)
          if (a = {
              element: r,
              isDehydrated: !1,
              cache: i.cache,
              pendingSuspenseBoundaries: i.pendingSuspenseBoundaries,
              transitions: i.transitions
            }, t.updateQueue.baseState = a, t.memoizedState = a, t.flags & 256) {
            l = jn(Error(j(423)), t), t = po(e, t, r, n, l);
            break e
          } else if (r !== l) {
          l = jn(Error(j(424)), t), t = po(e, t, r, n, l);
          break e
        } else
          for (Se = kt(t.stateNode.containerInfo.firstChild), be = t, Y = !0, Oe = null, n = $u(t, null, r, n), t.child = n; n;) n.flags = n.flags & -3 | 4096, n = n.sibling;
        else {
          if (xn(), r === l) {
            t = ot(e, t, n);
            break e
          }
          me(e, t, r, n)
        }
        t = t.child
      }
      return t;
    case 5:
      return qu(t), e === null && ts(t), r = t.type, l = t.pendingProps, a = e !== null ? e.memoizedProps : null, i = l.children, Ga(r, l) ? i = null : a !== null && Ga(r, a) && (t.flags |= 32), xc(e, t), me(e, t, i, n), t.child;
    case 6:
      return e === null && ts(t), null;
    case 13:
      return wc(e, t, n);
    case 4:
      return Gs(t, t.stateNode.containerInfo), r = t.pendingProps, e === null ? t.child = kn(t, null, r, n) : me(e, t, r, n), t.child;
    case 11:
      return r = t.type, l = t.pendingProps, l = t.elementType === r ? l : _e(r, l), uo(e, t, r, l, n);
    case 7:
      return me(e, t, t.pendingProps, n), t.child;
    case 8:
      return me(e, t, t.pendingProps.children, n), t.child;
    case 12:
      return me(e, t, t.pendingProps.children, n), t.child;
    case 10:
      e: {
        if (r = t.type._context, l = t.pendingProps, a = t.memoizedProps, i = l.value, H(gl, r._currentValue), r._currentValue = i, a !== null)
          if (Ve(a.value, i)) {
            if (a.children === l.children && !ke.current) {
              t = ot(e, t, n);
              break e
            }
          } else
            for (a = t.child, a !== null && (a.return = t); a !== null;) {
              var o = a.dependencies;
              if (o !== null) {
                i = a.child;
                for (var u = o.firstContext; u !== null;) {
                  if (u.context === r) {
                    if (a.tag === 1) {
                      u = lt(-1, n & -n), u.tag = 2;
                      var c = a.updateQueue;
                      if (c !== null) {
                        c = c.shared;
                        var g = c.pending;
                        g === null ? u.next = u : (u.next = g.next, g.next = u), c.pending = u
                      }
                    }
                    a.lanes |= n, u = a.alternate, u !== null && (u.lanes |= n), ns(a.return, n, t), o.lanes |= n;
                    break
                  }
                  u = u.next
                }
              } else if (a.tag === 10) i = a.type === t.type ? null : a.child;
              else if (a.tag === 18) {
                if (i = a.return, i === null) throw Error(j(341));
                i.lanes |= n, o = i.alternate, o !== null && (o.lanes |= n), ns(i, n, t), i = a.sibling
              } else i = a.child;
              if (i !== null) i.return = a;
              else
                for (i = a; i !== null;) {
                  if (i === t) {
                    i = null;
                    break
                  }
                  if (a = i.sibling, a !== null) {
                    a.return = i.return, i = a;
                    break
                  }
                  i = i.return
                }
              a = i
            }
        me(e, t, l.children, n),
        t = t.child
      }
      return t;
    case 9:
      return l = t.type, r = t.pendingProps.children, hn(t, n), l = Re(l), r = r(l), t.flags |= 1, me(e, t, r, n), t.child;
    case 14:
      return r = t.type, l = _e(r, t.pendingProps), l = _e(r.type, l), co(e, t, r, l, n);
    case 15:
      return yc(e, t, t.type, t.pendingProps, n);
    case 17:
      return r = t.type, l = t.pendingProps, l = t.elementType === r ? l : _e(r, l), Xr(e, t), t.tag = 1, we(r) ? (e = !0, pl(t)) : e = !1, hn(t, n), mc(t, r, l), ls(t, r, l, n), is(null, t, r, !0, e, n);
    case 19:
      return jc(e, t, n);
    case 22:
      return vc(e, t, n)
  }
  throw Error(j(156, t.tag))
};

function _c(e, t) {
  return du(e, t)
}

function fp(e, t, n, r) {
  this.tag = e, this.key = n, this.sibling = this.child = this.return = this.stateNode = this.type = this.elementType = null, this.index = 0, this.ref = null, this.pendingProps = t, this.dependencies = this.memoizedState = this.updateQueue = this.memoizedProps = null, this.mode = r, this.subtreeFlags = this.flags = 0, this.deletions = null, this.childLanes = this.lanes = 0, this.alternate = null
}

function Ie(e, t, n, r) {
  return new fp(e, t, n, r)
}

function di(e) {
  return e = e.prototype, !(!e || !e.isReactComponent)
}

function pp(e) {
  if (typeof e == "function") return di(e) ? 1 : 0;
  if (e != null) {
    if (e = e.$$typeof, e === Ts) return 11;
    if (e === Ms) return 14
  }
  return 2
}

function St(e, t) {
  var n = e.alternate;
  return n === null ? (n = Ie(e.tag, t, e.key, e.mode), n.elementType = e.elementType, n.type = e.type, n.stateNode = e.stateNode, n.alternate = e, e.alternate = n) : (n.pendingProps = t, n.type = e.type, n.flags = 0, n.subtreeFlags = 0, n.deletions = null), n.flags = e.flags & 14680064, n.childLanes = e.childLanes, n.lanes = e.lanes, n.child = e.child, n.memoizedProps = e.memoizedProps, n.memoizedState = e.memoizedState, n.updateQueue = e.updateQueue, t = e.dependencies, n.dependencies = t === null ? null : {
    lanes: t.lanes,
    firstContext: t.firstContext
  }, n.sibling = e.sibling, n.index = e.index, n.ref = e.ref, n
}

function nl(e, t, n, r, l, a) {
  var i = 2;
  if (r = e, typeof e == "function") di(e) && (i = 1);
  else if (typeof e == "string") i = 5;
  else e: switch (e) {
    case Xt:
      return Ot(n.children, l, a, t);
    case Ps:
      i = 8, l |= 8;
      break;
    case Aa:
      return e = Ie(12, n, t, l | 2), e.elementType = Aa, e.lanes = a, e;
    case Pa:
      return e = Ie(13, n, t, l), e.elementType = Pa, e.lanes = a, e;
    case Ta:
      return e = Ie(19, n, t, l), e.elementType = Ta, e.lanes = a, e;
    case qo:
      return _l(n, l, a, t);
    default:
      if (typeof e == "object" && e !== null) switch (e.$$typeof) {
        case Ko:
          i = 10;
          break e;
        case Yo:
          i = 9;
          break e;
        case Ts:
          i = 11;
          break e;
        case Ms:
          i = 14;
          break e;
        case dt:
          i = 16, r = null;
          break e
      }
      throw Error(j(130, e == null ? e : typeof e, ""))
  }
  return t = Ie(i, n, t, l), t.elementType = e, t.type = r, t.lanes = a, t
}

function Ot(e, t, n, r) {
  return e = Ie(7, e, r, t), e.lanes = n, e
}

function _l(e, t, n, r) {
  return e = Ie(22, e, r, t), e.elementType = qo, e.lanes = n, e.stateNode = {
    isHidden: !1
  }, e
}

function ga(e, t, n) {
  return e = Ie(6, e, null, t), e.lanes = n, e
}

function ya(e, t, n) {
  return t = Ie(4, e.children !== null ? e.children : [], e.key, t), t.lanes = n, t.stateNode = {
    containerInfo: e.containerInfo,
    pendingChildren: null,
    implementation: e.implementation
  }, t
}

function mp(e, t, n, r, l) {
  this.tag = t, this.containerInfo = e, this.finishedWork = this.pingCache = this.current = this.pendingChildren = null, this.timeoutHandle = -1, this.callbackNode = this.pendingContext = this.context = null, this.callbackPriority = 0, this.eventTimes = Zl(0), this.expirationTimes = Zl(-1), this.entangledLanes = this.finishedLanes = this.mutableReadLanes = this.expiredLanes = this.pingedLanes = this.suspendedLanes = this.pendingLanes = 0, this.entanglements = Zl(0), this.identifierPrefix = r, this.onRecoverableError = l, this.mutableSourceEagerHydrationData = null
}

function fi(e, t, n, r, l, a, i, o, u) {
  return e = new mp(e, t, n, o, u), t === 1 ? (t = 1, a === !0 && (t |= 8)) : t = 0, a = Ie(3, null, null, t), e.current = a, a.stateNode = e, a.memoizedState = {
    element: r,
    isDehydrated: n,
    cache: null,
    transitions: null,
    pendingSuspenseBoundaries: null
  }, Qs(a), e
}

function hp(e, t, n) {
  var r = 3 < arguments.length && arguments[3] !== void 0 ? arguments[3] : null;
  return {
    $$typeof: Jt,
    key: r == null ? null : "" + r,
    children: e,
    containerInfo: t,
    implementation: n
  }
}

function Bc(e) {
  if (!e) return Ct;
  e = e._reactInternals;
  e: {
    if (Yt(e) !== e || e.tag !== 1) throw Error(j(170));
    var t = e;do {
      switch (t.tag) {
        case 3:
          t = t.stateNode.context;
          break e;
        case 1:
          if (we(t.type)) {
            t = t.stateNode.__reactInternalMemoizedMergedChildContext;
            break e
          }
      }
      t = t.return
    } while (t !== null);
    throw Error(j(171))
  }
  if (e.tag === 1) {
    var n = e.type;
    if (we(n)) return Bu(e, n, t)
  }
  return t
}

function Oc(e, t, n, r, l, a, i, o, u) {
  return e = fi(n, r, !0, e, l, a, i, o, u), e.context = Bc(null), n = e.current, r = he(), l = Nt(n), a = lt(r, l), a.callback = t ?? null, wt(n, a, l), e.current.lanes = l, xr(e, l, r), je(e, r), e
}

function Bl(e, t, n, r) {
  var l = t.current,
    a = he(),
    i = Nt(l);
  return n = Bc(n), t.context === null ? t.context = n : t.pendingContext = n, t = lt(a, i), t.payload = {
    element: e
  }, r = r === void 0 ? null : r, r !== null && (t.callback = r), e = wt(l, t, i), e !== null && (Ue(e, l, i, a), Gr(e, l, i)), i
}

function Cl(e) {
  if (e = e.current, !e.child) return null;
  switch (e.child.tag) {
    case 5:
      return e.child.stateNode;
    default:
      return e.child.stateNode
  }
}

function No(e, t) {
  if (e = e.memoizedState, e !== null && e.dehydrated !== null) {
    var n = e.retryLane;
    e.retryLane = n !== 0 && n < t ? n : t
  }
}

function pi(e, t) {
  No(e, t), (e = e.alternate) && No(e, t)
}

function gp() {
  return null
}
var Wc = typeof reportError == "function" ? reportError : function(e) {
  console.error(e)
};

function mi(e) {
  this._internalRoot = e
}
Ol.prototype.render = mi.prototype.render = function(e) {
  var t = this._internalRoot;
  if (t === null) throw Error(j(409));
  Bl(e, t, null, null)
};
Ol.prototype.unmount = mi.prototype.unmount = function() {
  var e = this._internalRoot;
  if (e !== null) {
    this._internalRoot = null;
    var t = e.containerInfo;
    $t(function() {
      Bl(null, e, null, null)
    }), t[st] = null
  }
};

function Ol(e) {
  this._internalRoot = e
}
Ol.prototype.unstable_scheduleHydration = function(e) {
  if (e) {
    var t = vu();
    e = {
      blockedOn: null,
      target: e,
      priority: t
    };
    for (var n = 0; n < pt.length && t !== 0 && t < pt[n].priority; n++);
    pt.splice(n, 0, e), n === 0 && ku(e)
  }
};

function hi(e) {
  return !(!e || e.nodeType !== 1 && e.nodeType !== 9 && e.nodeType !== 11)
}

function Wl(e) {
  return !(!e || e.nodeType !== 1 && e.nodeType !== 9 && e.nodeType !== 11 && (e.nodeType !== 8 || e.nodeValue !== " react-mount-point-unstable "))
}

function So() {}

function yp(e, t, n, r, l) {
  if (l) {
    if (typeof r == "function") {
      var a = r;
      r = function() {
        var c = Cl(i);
        a.call(c)
      }
    }
    var i = Oc(t, r, e, 0, null, !1, !1, "", So);
    return e._reactRootContainer = i, e[st] = i.current, ar(e.nodeType === 8 ? e.parentNode : e), $t(), i
  }
  for (; l = e.lastChild;) e.removeChild(l);
  if (typeof r == "function") {
    var o = r;
    r = function() {
      var c = Cl(u);
      o.call(c)
    }
  }
  var u = fi(e, 0, !1, null, null, !1, !1, "", So);
  return e._reactRootContainer = u, e[st] = u.current, ar(e.nodeType === 8 ? e.parentNode : e), $t(function() {
    Bl(t, u, n, r)
  }), u
}

function Ul(e, t, n, r, l) {
  var a = n._reactRootContainer;
  if (a) {
    var i = a;
    if (typeof l == "function") {
      var o = l;
      l = function() {
        var u = Cl(i);
        o.call(u)
      }
    }
    Bl(t, i, e, l)
  } else i = yp(n, t, e, l, r);
  return Cl(i)
}
gu = function(e) {
  switch (e.tag) {
    case 3:
      var t = e.stateNode;
      if (t.current.memoizedState.isDehydrated) {
        var n = On(t.pendingLanes);
        n !== 0 && (Rs(t, n | 1), je(t, X()), !(O & 6) && (Nn = X() + 500, Pt()))
      }
      break;
    case 13:
      $t(function() {
        var r = it(e, 1);
        if (r !== null) {
          var l = he();
          Ue(r, e, 1, l)
        }
      }), pi(e, 1)
  }
};
Fs = function(e) {
  if (e.tag === 13) {
    var t = it(e, 134217728);
    if (t !== null) {
      var n = he();
      Ue(t, e, 134217728, n)
    }
    pi(e, 134217728)
  }
};
yu = function(e) {
  if (e.tag === 13) {
    var t = Nt(e),
      n = it(e, t);
    if (n !== null) {
      var r = he();
      Ue(n, e, t, r)
    }
    pi(e, t)
  }
};
vu = function() {
  return U
};
xu = function(e, t) {
  var n = U;
  try {
    return U = e, t()
  } finally {
    U = n
  }
};
Oa = function(e, t, n) {
  switch (t) {
    case "input":
      if (La(e, n), t = n.name, n.type === "radio" && t != null) {
        for (n = e; n.parentNode;) n = n.parentNode;
        for (n = n.querySelectorAll("input[name=" + JSON.stringify("" + t) + '][type="radio"]'), t = 0; t < n.length; t++) {
          var r = n[t];
          if (r !== e && r.form === e.form) {
            var l = Il(r);
            if (!l) throw Error(j(90));
            Go(r), La(r, l)
          }
        }
      }
      break;
    case "textarea":
      Jo(e, n);
      break;
    case "select":
      t = n.value, t != null && dn(e, !!n.multiple, t, !1)
  }
};
au = oi;
su = $t;
var vp = {
    usingClientEntryPoint: !1,
    Events: [wr, rn, Il, ru, lu, oi]
  },
  zn = {
    findFiberByHostInstance: Ft,
    bundleType: 0,
    version: "18.3.1",
    rendererPackageName: "react-dom"
  },
  xp = {
    bundleType: zn.bundleType,
    version: zn.version,
    rendererPackageName: zn.rendererPackageName,
    rendererConfig: zn.rendererConfig,
    overrideHookState: null,
    overrideHookStateDeletePath: null,
    overrideHookStateRenamePath: null,
    overrideProps: null,
    overridePropsDeletePath: null,
    overridePropsRenamePath: null,
    setErrorHandler: null,
    setSuspenseHandler: null,
    scheduleUpdate: null,
    currentDispatcherRef: ut.ReactCurrentDispatcher,
    findHostInstanceByFiber: function(e) {
      return e = uu(e), e === null ? null : e.stateNode
    },
    findFiberByHostInstance: zn.findFiberByHostInstance || gp,
    findHostInstancesForRefresh: null,
    scheduleRefresh: null,
    scheduleRoot: null,
    setRefreshHandler: null,
    getCurrentFiber: null,
    reconcilerVersion: "18.3.1-next-f1338f8080-20240426"
  };
if (typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ < "u") {
  var Hr = __REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (!Hr.isDisabled && Hr.supportsFiber) try {
    Al = Hr.inject(xp), Je = Hr
  } catch {}
}
Ae.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED = vp;
Ae.createPortal = function(e, t) {
  var n = 2 < arguments.length && arguments[2] !== void 0 ? arguments[2] : null;
  if (!hi(t)) throw Error(j(200));
  return hp(e, t, null, n)
};
Ae.createRoot = function(e, t) {
  if (!hi(e)) throw Error(j(299));
  var n = !1,
    r = "",
    l = Wc;
  return t != null && (t.unstable_strictMode === !0 && (n = !0), t.identifierPrefix !== void 0 && (r = t.identifierPrefix), t.onRecoverableError !== void 0 && (l = t.onRecoverableError)), t = fi(e, 1, !1, null, null, n, !1, r, l), e[st] = t.current, ar(e.nodeType === 8 ? e.parentNode : e), new mi(t)
};
Ae.findDOMNode = function(e) {
  if (e == null) return null;
  if (e.nodeType === 1) return e;
  var t = e._reactInternals;
  if (t === void 0) throw typeof e.render == "function" ? Error(j(188)) : (e = Object.keys(e).join(","), Error(j(268, e)));
  return e = uu(t), e = e === null ? null : e.stateNode, e
};
Ae.flushSync = function(e) {
  return $t(e)
};
Ae.hydrate = function(e, t, n) {
  if (!Wl(t)) throw Error(j(200));
  return Ul(null, e, t, !0, n)
};
Ae.hydrateRoot = function(e, t, n) {
  if (!hi(e)) throw Error(j(405));
  var r = n != null && n.hydratedSources || null,
    l = !1,
    a = "",
    i = Wc;
  if (n != null && (n.unstable_strictMode === !0 && (l = !0), n.identifierPrefix !== void 0 && (a = n.identifierPrefix), n.onRecoverableError !== void 0 && (i = n.onRecoverableError)), t = Oc(t, null, e, 1, n ?? null, l, !1, a, i), e[st] = t.current, ar(e), r)
    for (e = 0; e < r.length; e++) n = r[e], l = n._getVersion, l = l(n._source), t.mutableSourceEagerHydrationData == null ? t.mutableSourceEagerHydrationData = [n, l] : t.mutableSourceEagerHydrationData.push(n, l);
  return new Ol(t)
};
Ae.render = function(e, t, n) {
  if (!Wl(t)) throw Error(j(200));
  return Ul(null, e, t, !1, n)
};
Ae.unmountComponentAtNode = function(e) {
  if (!Wl(e)) throw Error(j(40));
  return e._reactRootContainer ? ($t(function() {
    Ul(null, null, e, !1, function() {
      e._reactRootContainer = null, e[st] = null
    })
  }), !0) : !1
};
Ae.unstable_batchedUpdates = oi;
Ae.unstable_renderSubtreeIntoContainer = function(e, t, n, r) {
  if (!Wl(n)) throw Error(j(200));
  if (e == null || e._reactInternals === void 0) throw Error(j(38));
  return Ul(e, t, n, !1, r)
};
Ae.version = "18.3.1-next-f1338f8080-20240426";

function Uc() {
  if (!(typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ > "u" || typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE != "function")) try {
    __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE(Uc)
  } catch (e) {
    console.error(e)
  }
}
Uc(), Uo.exports = Ae;
var kp = Uo.exports,
  bo = kp;
Ca.createRoot = bo.createRoot, Ca.hydrateRoot = bo.hydrateRoot;
const Hc = C.createContext({
  lang: "ar",
  dir: "rtl",
  t: e => e,
  setLang: () => {}
});

function wp() {
  try {
    const e = localStorage.getItem("kb-lang");
    if (e === "ar" || e === "en") return e
  } catch {}
  return "ar"
}

function jp({
  children: e
}) {
  const [t, n] = C.useState(wp), r = a => {
    n(a);
    try {
      localStorage.setItem("kb-lang", a)
    } catch {}
  }, l = C.useMemo(() => ({
    lang: t,
    dir: t === "ar" ? "rtl" : "ltr",
    setLang: r,
    t: a => a && typeof a == "object" && ("en" in a || "ar" in a) ? a[t] ?? a.en ?? "" : a ?? ""
  }), [t]);
  return C.useEffect(() => {
    document.documentElement.setAttribute("lang", t), document.documentElement.setAttribute("dir", t === "ar" ? "rtl" : "ltr")
  }, [t]), s.jsx(Hc.Provider, {
    value: l,
    children: e
  })
}
const V = () => C.useContext(Hc);

function Np(e, t) {
  return String(e).replace(/\{(\w+)\}/g, (n, r) => t[r] ?? "")
}
const He = "962776788972",
  Vc = "077 678 8972",
  Ce = [{
    id: "clinic",
    icon: "Stethoscope",
    label: {
      en: "Clinic",
      ar: "عيادة"
    },
    noun: {
      en: "appointments",
      ar: "المواعيد"
    },
    unit: {
      en: "appointment",
      ar: "موعد"
    }
  }, {
    id: "restaurant",
    icon: "UtensilsCrossed",
    label: {
      en: "Restaurant / Café",
      ar: "مطعم / كافيه"
    },
    noun: {
      en: "orders and tables",
      ar: "الطلبات والطاولات"
    },
    unit: {
      en: "table",
      ar: "طاولة"
    }
  }, {
    id: "playground",
    icon: "PartyPopper",
    label: {
      en: "Kids center",
      ar: "مركز ترفيه أطفال"
    },
    noun: {
      en: "parties and visits",
      ar: "الحفلات والزيارات"
    },
    unit: {
      en: "birthday party",
      ar: "حفلة عيد ميلاد"
    }
  }, {
    id: "salon",
    icon: "Scissors",
    label: {
      en: "Salon",
      ar: "صالون"
    },
    noun: {
      en: "appointments",
      ar: "المواعيد"
    },
    unit: {
      en: "appointment",
      ar: "موعد"
    }
  }, {
    id: "realestate",
    icon: "Building2",
    label: {
      en: "Real estate",
      ar: "عقارات"
    },
    noun: {
      en: "viewings",
      ar: "المعاينات"
    },
    unit: {
      en: "viewing",
      ar: "معاينة"
    }
  }, {
    id: "general",
    icon: "Briefcase",
    label: {
      en: "General business",
      ar: "نشاط تجاري عام"
    },
    noun: {
      en: "requests",
      ar: "الطلبات"
    },
    unit: {
      en: "appointment",
      ar: "موعد"
    }
  }],
  mr = [{
    id: "receptionist",
    icon: "Headphones",
    label: {
      en: "AI Receptionist",
      ar: "موظف استقبال ذكي"
    },
    does: {
      en: "answers common questions instantly and routes each customer to the right place.",
      ar: "يجيب عن الأسئلة الشائعة فورًا ويوجّه كل عميل إلى المكان الصحيح."
    }
  }, {
    id: "sales",
    icon: "TrendingUp",
    label: {
      en: "AI Sales Agent",
      ar: "وكيل مبيعات ذكي"
    },
    does: {
      en: "replies to every lead, answers pricing, qualifies interest, and follows up until they decide.",
      ar: "يردّ على كل عميل محتمل، يجيب عن الأسعار، يقيس الاهتمام، ويتابع حتى القرار."
    }
  }, {
    id: "booking",
    icon: "CalendarCheck",
    label: {
      en: "AI Booking Agent",
      ar: "وكيل حجوزات ذكي"
    },
    does: {
      en: "offers available times, confirms the booking, and sends reminders before it.",
      ar: "يعرض الأوقات المتاحة، يثبّت الحجز، ويرسل تذكيرًا قبله."
    }
  }, {
    id: "followup",
    icon: "Repeat",
    label: {
      en: "AI Follow-up Agent",
      ar: "وكيل متابعة ذكي"
    },
    does: {
      en: "brings back quiet leads, reminds about payments, and re-engages past customers.",
      ar: "يعيد العملاء الصامتين، يذكّر بالدفعات، ويعيد تنشيط العملاء السابقين."
    }
  }, {
    id: "ops",
    icon: "ClipboardList",
    label: {
      en: "AI Operations Assistant",
      ar: "مساعد عمليات ذكي"
    },
    does: {
      en: "turns conversations into tasks, assigns them to staff, and chases what is late.",
      ar: "يحوّل المحادثات إلى مهام، يوزّعها على الفريق، ويتابع المتأخر منها."
    }
  }, {
    id: "reporting",
    icon: "BarChart3",
    label: {
      en: "AI Reporting Assistant",
      ar: "مساعد تقارير ذكي"
    },
    does: {
      en: "sends you a clear summary every day: leads, bookings, revenue, and what needs you.",
      ar: "يرسل لك ملخصًا واضحًا كل يوم: العملاء، الحجوزات، الإيراد، وما يحتاج تدخّلك."
    }
  }],
  hr = [{
    id: "whatsapp",
    icon: "MessageCircle",
    label: {
      en: "WhatsApp",
      ar: "واتساب"
    }
  }, {
    id: "web",
    icon: "Globe",
    label: {
      en: "Website chat",
      ar: "دردشة الموقع"
    }
  }, {
    id: "instagram",
    icon: "Instagram",
    label: {
      en: "Instagram DM",
      ar: "رسائل إنستغرام"
    }
  }, {
    id: "voice",
    icon: "Phone",
    label: {
      en: "Phone / voice",
      ar: "الهاتف / صوتي"
    }
  }, {
    id: "multi",
    icon: "Layers",
    label: {
      en: "Multi-channel",
      ar: "كل القنوات"
    }
  }],
  xs = [{
    id: "slow",
    icon: "Clock",
    label: {
      en: "Slow replies",
      ar: "ردود بطيئة"
    },
    impact: {
      en: "Reply time: hours → seconds",
      ar: "زمن الردّ: من ساعات إلى ثوانٍ"
    },
    metric: {
      value: 5,
      suffix: {
        en: "sec",
        ar: "ثوانٍ"
      },
      label: {
        en: "average reply",
        ar: "متوسط الردّ"
      }
    }
  }, {
    id: "missed",
    icon: "UserX",
    label: {
      en: "Missed leads",
      ar: "عملاء ضائعون"
    },
    impact: {
      en: "Every lead answered and logged, 24/7",
      ar: "كل عميل يُجاب ويُسجَّل، على مدار الساعة"
    },
    metric: {
      value: 100,
      suffix: {
        en: "%",
        ar: "٪"
      },
      label: {
        en: "leads answered",
        ar: "عملاء تمّ الردّ عليهم"
      }
    }
  }, {
    id: "manual",
    icon: "PenLine",
    label: {
      en: "Manual bookings",
      ar: "حجوزات يدوية"
    },
    impact: {
      en: "Most bookings confirmed with no staff involved",
      ar: "أغلب الحجوزات تُثبَّت دون تدخّل الموظفين"
    },
    metric: {
      value: 80,
      suffix: {
        en: "%",
        ar: "٪"
      },
      label: {
        en: "bookings automated",
        ar: "حجوزات آلية"
      }
    }
  }, {
    id: "nofollow",
    icon: "BellOff",
    label: {
      en: "No follow-up",
      ar: "لا متابعة"
    },
    impact: {
      en: "A follow-up for every lead that goes quiet",
      ar: "متابعة لكل عميل يصمت"
    },
    metric: {
      value: 3,
      suffix: {
        en: "x",
        ar: "×"
      },
      label: {
        en: "more conversations closed",
        ar: "محادثات مُغلقة أكثر"
      }
    }
  }, {
    id: "overload",
    icon: "Users",
    label: {
      en: "Staff overload",
      ar: "ضغط على الفريق"
    },
    impact: {
      en: "Routine questions off your team's plate",
      ar: "الأسئلة الروتينية خارج جدول فريقك"
    },
    metric: {
      value: 40,
      suffix: {
        en: "h",
        ar: "ساعة"
      },
      label: {
        en: "saved per month",
        ar: "موفَّرة شهريًا"
      }
    }
  }, {
    id: "noreports",
    icon: "FileBarChart",
    label: {
      en: "No clear reports",
      ar: "لا تقارير واضحة"
    },
    impact: {
      en: "A daily summary, every evening",
      ar: "ملخص يومي، كل مساء"
    },
    metric: {
      value: 1,
      suffix: {
        en: "/day",
        ar: "/يوم"
      },
      label: {
        en: "owner report",
        ar: "تقرير للمالك"
      }
    }
  }],
  Sp = {
    receptionist: [{
      en: 'Answer "are you open?", location, and prices in seconds',
      ar: 'الردّ على "فاتحين؟" والموقع والأسعار خلال ثوانٍ'
    }, {
      en: "Route a complaint or a special request to a human",
      ar: "تحويل الشكوى أو الطلب الخاص إلى موظف"
    }, {
      en: "Collect the caller's name and reason before handoff",
      ar: "تسجيل اسم العميل وسبب التواصل قبل التحويل"
    }],
    sales: [{
      en: "Answer pricing questions with your real price list",
      ar: "الإجابة عن الأسعار من قائمتك الفعلية"
    }, {
      en: "Ask the two questions that qualify a serious lead",
      ar: "طرح السؤالين اللذين يميّزان العميل الجاد"
    }, {
      en: "Follow up after 24 hours if the lead goes quiet",
      ar: "المتابعة بعد 24 ساعة إذا صمت العميل"
    }, {
      en: "Send you a daily lead report",
      ar: "إرسال تقرير يومي بالعملاء المحتملين"
    }],
    booking: [{
      en: "Offer the next available slots for a {unit}",
      ar: "عرض أقرب الأوقات المتاحة لـ{unit}"
    }, {
      en: "Confirm the booking and add it to your calendar",
      ar: "تثبيت الحجز وإضافته إلى تقويمك"
    }, {
      en: "Send a reminder one hour before",
      ar: "إرسال تذكير قبل الموعد بساعة"
    }, {
      en: "Handle reschedules without a phone call",
      ar: "تعديل المواعيد دون مكالمة"
    }],
    followup: [{
      en: "Message leads that never replied",
      ar: "مراسلة العملاء الذين لم يردّوا"
    }, {
      en: "Remind customers about unpaid balances",
      ar: "تذكير العملاء بالمبالغ غير المدفوعة"
    }, {
      en: "Re-engage customers who haven't visited in 60 days",
      ar: "إعادة تنشيط من لم يزر منذ 60 يومًا"
    }],
    ops: [{
      en: 'Turn "the AC is broken" into a task for maintenance',
      ar: 'تحويل "المكيّف معطّل" إلى مهمة للصيانة'
    }, {
      en: "Assign {noun} to the right staff member",
      ar: "إسناد {noun} إلى الموظف المناسب"
    }, {
      en: "Chase anything still open at end of day",
      ar: "متابعة كل ما بقي مفتوحًا نهاية اليوم"
    }],
    reporting: [{
      en: "Daily summary: leads, {noun}, revenue, and missed messages",
      ar: "ملخص يومي: العملاء، {noun}، الإيراد، والرسائل الفائتة"
    }, {
      en: "Flag the three things that need your decision",
      ar: "إبراز ثلاثة أمور تحتاج قرارك"
    }, {
      en: "Weekly trend: what grew and what slipped",
      ar: "اتجاه أسبوعي: ما نما وما تراجع"
    }]
  },
  bp = [{
    id: "reply",
    icon: "Zap",
    label: {
      en: "Reply instantly",
      ar: "ردّ فوري"
    },
    locked: !0
  }, {
    id: "lead",
    icon: "UserPlus",
    label: {
      en: "Capture lead",
      ar: "تسجيل العميل"
    }
  }, {
    id: "booking",
    icon: "CalendarCheck",
    label: {
      en: "Booking",
      ar: "حجز"
    }
  }, {
    id: "followup",
    icon: "Repeat",
    label: {
      en: "Follow-up",
      ar: "متابعة"
    }
  }, {
    id: "payment",
    icon: "CreditCard",
    label: {
      en: "Payment reminder",
      ar: "تذكير بالدفع"
    }
  }, {
    id: "report",
    icon: "BarChart3",
    label: {
      en: "Daily report",
      ar: "تقرير يومي"
    }
  }, {
    id: "human",
    icon: "UserRound",
    label: {
      en: "Human handoff",
      ar: "تحويل لموظف"
    }
  }],
  va = [{
    id: "receptionist",
    icon: "Headphones",
    name: {
      en: "AI Receptionist",
      ar: "موظف الاستقبال الذكي"
    },
    desc: {
      en: "Answers common questions and routes customers.",
      ar: "يجيب عن الأسئلة الشائعة ويوجّه العملاء."
    },
    example: {
      en: `"We're open until 11 pm. Want me to book you a table?"`,
      ar: '"نعمل حتى 11 مساءً. أحجز لك طاولة؟"'
    },
    best: ["restaurant", "clinic", "general"]
  }, {
    id: "sales",
    icon: "TrendingUp",
    name: {
      en: "AI Sales Agent",
      ar: "وكيل المبيعات الذكي"
    },
    desc: {
      en: "Qualifies leads and follows up until they decide.",
      ar: "يقيس جدية العميل ويتابعه حتى القرار."
    },
    example: {
      en: '"The 2-bedroom starts at 85,000 JD. Want a viewing this week?"',
      ar: '"شقة الغرفتين تبدأ من 85,000 دينار. تحب معاينة هذا الأسبوع؟"'
    },
    best: ["realestate", "salon", "general"]
  }, {
    id: "booking",
    icon: "CalendarCheck",
    name: {
      en: "AI Booking Agent",
      ar: "وكيل الحجوزات الذكي"
    },
    desc: {
      en: "Handles appointments, confirmations, and reminders.",
      ar: "يتولّى المواعيد والتأكيدات والتذكيرات."
    },
    example: {
      en: '"Confirmed: Thursday 11:00 with Dr. Rana. Reminder at 10:00."',
      ar: '"تم التثبيت: الخميس 11:00 مع د. رنا. تذكير الساعة 10:00."'
    },
    best: ["clinic", "salon", "playground"]
  }, {
    id: "support",
    icon: "LifeBuoy",
    name: {
      en: "AI Support Agent",
      ar: "وكيل الدعم الذكي"
    },
    desc: {
      en: "Answers customer questions from your own knowledge.",
      ar: "يجيب عن أسئلة العملاء من معلوماتك أنت."
    },
    example: {
      en: '"Yes, parking is free for the first two hours."',
      ar: '"نعم، المواقف مجانية لأول ساعتين."'
    },
    best: ["playground", "restaurant", "general"]
  }, {
    id: "ops",
    icon: "ClipboardList",
    name: {
      en: "AI Ops Agent",
      ar: "وكيل العمليات الذكي"
    },
    desc: {
      en: "Creates tasks and reminders from conversations.",
      ar: "ينشئ المهام والتذكيرات من المحادثات."
    },
    example: {
      en: 'Task created → "Table 6 asked for a highchair" → assigned to Omar',
      ar: 'مهمة جديدة ← "طاولة 6 تطلب كرسي أطفال" ← أُسندت لعمر'
    },
    best: ["restaurant", "playground", "realestate"]
  }, {
    id: "report",
    icon: "BarChart3",
    name: {
      en: "AI Report Agent",
      ar: "وكيل التقارير الذكي"
    },
    desc: {
      en: "Sends a daily business summary you can read in a minute.",
      ar: "يرسل ملخصًا يوميًا تقرؤه في دقيقة."
    },
    example: {
      en: '"Today: 34 chats, 9 bookings, 2 need you. Revenue 1,240 JD."',
      ar: '"اليوم: 34 محادثة، 9 حجوزات، 2 تحتاجك. الإيراد 1,240 دينار."'
    },
    best: ["clinic", "restaurant", "salon", "realestate", "playground", "general"]
  }],
  Co = [{
    id: "clinic",
    label: {
      en: "Clinics",
      ar: "العيادات"
    },
    problem: {
      en: "The phone rings while the receptionist is with a patient. Half the bookings come by WhatsApp at night.",
      ar: "الهاتف يرنّ والموظفة مع مريض. نصف الحجوزات تأتي عبر واتساب ليلًا."
    },
    solution: {
      en: "Karam offers real free slots, confirms, reminds, and reschedules — the front desk only sees exceptions.",
      ar: "كرم يعرض الأوقات المتاحة فعليًا، يثبّت، يذكّر، ويعدّل. الاستقبال يرى الاستثناءات فقط."
    },
    example: {
      en: 'Patient: "Any slot tomorrow?" → Karam: "10:30 or 4:15 with Dr. Rana. Which one?"',
      ar: 'المريض: "في موعد بكرا؟" ← كرم: "10:30 أو 4:15 مع د. رنا. أيهما؟"'
    },
    result: {
      en: "Fewer no-shows, zero double bookings, evenings covered.",
      ar: "غياب أقل، لا حجوزات مزدوجة، والمساء مغطّى."
    }
  }, {
    id: "restaurant",
    label: {
      en: "Restaurants & cafés",
      ar: "المطاعم والكافيهات"
    },
    problem: {
      en: 'Dozens of "how much?", "are you open?", and delivery orders — all at the same hour.',
      ar: 'عشرات "بكم؟" و"فاتحين؟" وطلبات التوصيل، كلها في الساعة نفسها.'
    },
    solution: {
      en: "Karam answers from your menu, takes the order, collects the address, and pushes it to the kitchen.",
      ar: "كرم يجيب من قائمتك، يأخذ الطلب، يسجّل العنوان، ويرسله للمطبخ."
    },
    example: {
      en: '"2 beef burgers + large fries = 11.5 JD. Add a drink?"',
      ar: '"برجرين لحم + بطاطا كبيرة = 11.5 دينار. تضيف مشروب؟"'
    },
    result: {
      en: "Orders in under a minute; staff cook instead of typing.",
      ar: "الطلب خلال أقل من دقيقة، والفريق يطبخ بدل أن يكتب."
    }
  }, {
    id: "playground",
    label: {
      en: "Kids centers",
      ar: "مراكز الأطفال"
    },
    problem: {
      en: "Birthday bookings, school trips, coupons, working hours, and worried parents — all in one inbox.",
      ar: "حفلات أعياد الميلاد، الرحلات المدرسية، الكوبونات، ساعات العمل، وأسئلة الأهالي، كلها في صندوق واحد."
    },
    solution: {
      en: "Karam prices the party package, holds the slot, follows up on coupon campaigns, and sends a nightly operations report.",
      ar: "كرم يسعّر باقة الحفلة، يحجز الوقت، يتابع حملات الكوبونات، ويرسل تقرير العمليات كل ليلة."
    },
    example: {
      en: 'Parent: "Birthday for 12 kids Saturday?" → Karam: "Saturday 4–6 pm is free. Package B is 150 JD. Hold it?"',
      ar: 'الأم: "عيد ميلاد لـ12 طفلًا السبت؟" ← كرم: "السبت 4–6 مساءً متاح. الباقة ب 150 دينارًا. أحجزها؟"'
    },
    result: {
      en: "More parties booked, campaigns that actually get followed up.",
      ar: "حفلات أكثر، وحملات تُتابَع فعلًا."
    }
  }, {
    id: "salon",
    label: {
      en: "Salons",
      ar: "الصالونات"
    },
    problem: {
      en: "Stylists can't answer while working; clients book elsewhere.",
      ar: "المصفّفون لا يستطيعون الردّ أثناء العمل، فتحجز العميلة في مكان آخر."
    },
    solution: {
      en: "Karam books by stylist and service, confirms, and fills cancellations from the waitlist.",
      ar: "كرم يحجز حسب المصفّف والخدمة، يثبّت، ويملأ الإلغاءات من قائمة الانتظار."
    },
    example: {
      en: '"Hair color with Lina: Tuesday 2 pm is open. Book it?"',
      ar: '"صبغة شعر مع لينا: الثلاثاء 2 ظهرًا متاح. أحجزه؟"'
    },
    result: {
      en: "Chairs stay full; no client waits for a reply.",
      ar: "الكراسي ممتلئة، ولا عميلة تنتظر ردًّا."
    }
  }, {
    id: "realestate",
    label: {
      en: "Real estate",
      ar: "العقارات"
    },
    problem: {
      en: "Leads from ads arrive at all hours and cool off within minutes.",
      ar: "العملاء من الإعلانات يصلون في كل الأوقات ويبردون خلال دقائق."
    },
    solution: {
      en: "Karam qualifies budget and area, shares listings, books viewings, and follows up for two weeks.",
      ar: "كرم يقيس الميزانية والمنطقة، يشارك العروض، يحجز المعاينات، ويتابع لأسبوعين."
    },
    example: {
      en: '"Budget 90–110k, Abdoun? Two matches. Viewing Saturday 11 am?"',
      ar: '"ميزانية 90–110 ألفًا في عبدون؟ عرضان مناسبان. معاينة السبت 11 صباحًا؟"'
    },
    result: {
      en: "Every ad lead answered within seconds and tracked to a viewing.",
      ar: "كل عميل من الإعلانات يُجاب خلال ثوانٍ ويُتابَع حتى المعاينة."
    }
  }, {
    id: "general",
    label: {
      en: "Service businesses",
      ar: "الأنشطة الخدمية"
    },
    problem: {
      en: "Quotes, availability, and follow-ups live in someone's head.",
      ar: "الأسعار والتوفر والمتابعات محفوظة في رأس شخص واحد."
    },
    solution: {
      en: "Karam answers from your knowledge base, creates the task, and reports what is pending.",
      ar: "كرم يجيب من قاعدة معلوماتك، ينشئ المهمة، ويبلّغك بما هو معلّق."
    },
    example: {
      en: '"Deep cleaning for 150 m² is 60 JD. Thursday morning works?"',
      ar: '"تنظيف عميق لـ150 مترًا بـ60 دينارًا. الخميس صباحًا يناسبك؟"'
    },
    result: {
      en: "Nothing falls through the cracks.",
      ar: "لا شيء يضيع بين الرسائل."
    }
  }],
  xa = [{
    id: "price",
    label: {
      en: "Asks for price",
      ar: "يسأل عن السعر"
    },
    script: [{
      from: "c",
      en: "Hi, how much is a haircut and beard trim?",
      ar: "مرحبا، بكم قصة الشعر مع تهذيب الذقن؟"
    }, {
      from: "k",
      en: "Hi! Haircut is 8 JD, beard trim 4 JD — 11 JD together. Want me to book you a time?",
      ar: "أهلًا! القصّة 8 دنانير والذقن 4، معًا 11 دينارًا. أحجز لك موعدًا؟"
    }, {
      from: "c",
      en: "Yes, today after 5",
      ar: "نعم، اليوم بعد الخامسة"
    }, {
      from: "k",
      en: "Today 5:30 with Sami is free. Booked — see you at 5:30!",
      ar: "اليوم 5:30 مع سامي متاح. تم الحجز، نراك 5:30!"
    }]
  }, {
    id: "booking",
    label: {
      en: "Wants a booking",
      ar: "يريد حجزًا"
    },
    script: [{
      from: "c",
      en: "Table for 4 on Friday around 8?",
      ar: "طاولة لأربعة الجمعة حوالي 8؟"
    }, {
      from: "k",
      en: "Friday 8:00 pm for 4 — indoor or terrace?",
      ar: "الجمعة 8:00 مساءً لأربعة، داخلي أم تراس؟"
    }, {
      from: "c",
      en: "Terrace",
      ar: "تراس"
    }, {
      from: "k",
      en: "Done. Terrace table for 4, Friday 8:00 pm. Booking #4821. I'll remind you an hour before.",
      ar: "تم. طاولة تراس لأربعة، الجمعة 8:00 مساءً. رقم الحجز 4821. سأذكّرك قبل ساعة."
    }]
  }, {
    id: "location",
    label: {
      en: "Asks for location",
      ar: "يسأل عن الموقع"
    },
    script: [{
      from: "c",
      en: "Where are you exactly?",
      ar: "وين مكانكم بالضبط؟"
    }, {
      from: "k",
      en: "Wasfi Al-Tal Street, Irbid — 2nd floor above Saif Complex. Here is the map pin 📍. Parking is behind the building.",
      ar: "شارع وصفي التل، إربد، الطابق الثاني فوق مجمع سيف. هذا الموقع 📍. المواقف خلف المبنى."
    }, {
      from: "c",
      en: "Open now?",
      ar: "فاتحين هلأ؟"
    }, {
      from: "k",
      en: "Yes, until 11 pm today.",
      ar: "نعم، حتى 11 مساءً اليوم."
    }]
  }, {
    id: "complaint",
    label: {
      en: "Complains",
      ar: "يشتكي"
    },
    script: [{
      from: "c",
      en: "My order came cold and 40 minutes late.",
      ar: "الطلب وصل بارد ومتأخر 40 دقيقة."
    }, {
      from: "k",
      en: "I'm sorry — that's not the experience we want. I've logged it under order #1042 and alerted the manager. Would you prefer a replacement now or a credit on your next order?",
      ar: "أعتذر، هذه ليست التجربة التي نريدها. سجّلتها تحت الطلب 1042 ونبّهت المدير. تفضّل استبدالًا الآن أم رصيدًا للطلب القادم؟"
    }, {
      from: "c",
      en: "Replacement",
      ar: "استبدال"
    }, {
      from: "k",
      en: "On its way, no charge. The manager will call you in 5 minutes.",
      ar: "في الطريق دون رسوم. سيتصل بك المدير خلال 5 دقائق."
    }]
  }, {
    id: "offer",
    label: {
      en: "Asks for an offer",
      ar: "يسأل عن عرض"
    },
    script: [{
      from: "c",
      en: "Any offers this week?",
      ar: "في عروض هذا الأسبوع؟"
    }, {
      from: "k",
      en: "Yes — 15% off weekday bookings before 4 pm, and the family package is 25 JD instead of 32. Want me to hold a weekday slot?",
      ar: "نعم، خصم 15% على حجوزات أيام الأسبوع قبل 4 مساءً، وباقة العائلة بـ25 دينارًا بدل 32. أحجز لك موعدًا؟"
    }, {
      from: "c",
      en: "Wednesday 2 pm",
      ar: "الأربعاء 2 ظهرًا"
    }, {
      from: "k",
      en: "Held: Wednesday 2:00 pm, family package with 15% off. I'll send the coupon code now.",
      ar: "تم الحجز: الأربعاء 2:00 ظهرًا، باقة العائلة مع خصم 15%. سأرسل رمز الكوبون الآن."
    }]
  }],
  Qt = [{
    en: "How much is it?",
    ar: "بكم؟",
    intent: "price",
    icon: "Tag"
  }, {
    en: "Are you open today?",
    ar: "فاتحين اليوم؟",
    intent: "hours",
    icon: "Clock"
  }, {
    en: "Can I book?",
    ar: "بقدر أحجز؟",
    intent: "booking",
    icon: "CalendarCheck"
  }, {
    en: "Where are you located?",
    ar: "وين موقعكم؟",
    intent: "location",
    icon: "MapPin"
  }, {
    en: "Do you have an offer?",
    ar: "في عرض؟",
    intent: "offer",
    icon: "Percent"
  }, {
    en: "Can someone reply??",
    ar: "حدا يرد؟؟",
    intent: "urgent",
    icon: "AlertCircle"
  }],
  Cp = {
    price: {
      en: "Pricing",
      ar: "سعر"
    },
    hours: {
      en: "Hours",
      ar: "دوام"
    },
    booking: {
      en: "Booking",
      ar: "حجز"
    },
    location: {
      en: "Location",
      ar: "موقع"
    },
    offer: {
      en: "Offer",
      ar: "عرض"
    },
    urgent: {
      en: "Handoff",
      ar: "تحويل"
    }
  },
  Ep = ["WhatsApp Cloud API", "Google Sheets", "Google Calendar", "CRM", "Make", "Zapier", "n8n", "POS", "Dashboards"],
  N = {
    heroEyebrow: {
      en: "Karam Bot · a SHIFT AI & Automation product",
      ar: "كرم بوت · المنتج 01 من شِفت"
    },
    heroTitle: {
      en: "Build an AI agent that runs your customer conversations.",
      ar: "وكيل ذكاء اصطناعي يدير محادثات عملائك بدلًا منك."
    },
    heroSub: {
      en: "Karam Bot automates WhatsApp replies, bookings, sales follow-ups, support, and daily reports with agents built around your business.",
      ar: "يردّ على واتساب، ويحجز المواعيد، ويتابع المبيعات، ويخدم عملاءك، ويرسل لك تقرير اليوم. كل ذلك بوكلاء مبنيّين على طريقة عملك أنت."
    },
    ctaBuild: {
      en: "Build My AI Agent",
      ar: "ابنِ وكيلي الذكي"
    },
    ctaWatch: {
      en: "Watch It Work",
      ar: "شاهده يعمل"
    },
    ctaPlan: {
      en: "Get My AI Agent Plan",
      ar: "أرسل لي خطة وكيلي"
    },
    ctaAudit: {
      en: "Get Free Automation Audit",
      ar: "احصل على تدقيق أتمتة مجاني"
    },
    ctaWhatsApp: {
      en: "Contact on WhatsApp",
      ar: "تواصل عبر واتساب"
    },
    ctaShow: {
      en: "Show Me What To Automate",
      ar: "أرني ما يمكن أتمتته"
    },
    ctaStart: {
      en: "Start With One AI Agent",
      ar: "ابدأ بوكيل واحد"
    },
    meet: {
      en: "Meet",
      ar: "تعرّف على"
    },
    madlibHint: {
      en: "Tap any highlighted word to change it.",
      ar: "اضغط على أي كلمة ملوّنة لتغيّرها."
    },
    builderEyebrow: {
      en: "Build your AI agent in 60 seconds",
      ar: "ابنِ وكيلك الذكي خلال 60 ثانية"
    },
    builderTitle: {
      en: "Four choices. One agent, ready to describe itself.",
      ar: "أربعة اختيارات، ووكيل جاهز يعرّف عن نفسه."
    },
    steps: [{
      en: "Your business",
      ar: "نشاطك"
    }, {
      en: "Agent role",
      ar: "دور الوكيل"
    }, {
      en: "Main channel",
      ar: "القناة الرئيسية"
    }, {
      en: "Biggest pain",
      ar: "أكبر مشكلة"
    }, {
      en: "Your agent",
      ar: "وكيلك"
    }],
    next: {
      en: "Next",
      ar: "التالي"
    },
    back: {
      en: "Back",
      ar: "رجوع"
    },
    restart: {
      en: "Start over",
      ar: "ابدأ من جديد"
    },
    generate: {
      en: "Generate my agent",
      ar: "أنشئ وكيلي"
    },
    cardRole: {
      en: "Role",
      ar: "الدور"
    },
    cardTasks: {
      en: "Example tasks",
      ar: "أمثلة على المهام"
    },
    cardImpact: {
      en: "Estimated impact",
      ar: "الأثر المتوقّع"
    },
    typical: {
      en: "typical for similar businesses",
      ar: "نموذجي لمنشآت مشابهة"
    },
    inboxEyebrow: {
      en: "Inbox rescue",
      ar: "إنقاذ صندوق الرسائل"
    },
    inboxTitle: {
      en: "Six messages in ninety seconds. Watch what happens with and without Karam.",
      ar: "ست رسائل خلال تسعين ثانية. شاهد الفرق مع كرم وبدونه."
    },
    inboxStart: {
      en: "Start the rush",
      ar: "ابدأ الضغط"
    },
    inboxActivate: {
      en: "Activate Karam",
      ar: "شغّل كرم"
    },
    inboxReplay: {
      en: "Replay",
      ar: "إعادة"
    },
    unanswered: {
      en: "unanswered",
      ar: "بلا ردّ"
    },
    waiting: {
      en: "waiting",
      ar: "ينتظر"
    },
    before: {
      en: "Before",
      ar: "قبل"
    },
    after: {
      en: "After",
      ar: "بعد"
    },
    stats: {
      reply: {
        en: "Response time",
        ar: "زمن الردّ"
      },
      missed: {
        en: "Missed leads",
        ar: "عملاء ضائعون"
      },
      follow: {
        en: "Follow-ups created",
        ar: "متابعات أُنشئت"
      },
      hours: {
        en: "Hours saved / week",
        ar: "ساعات موفَّرة / أسبوع"
      }
    },
    flowEyebrow: {
      en: "Automation flow",
      ar: "مسار الأتمتة"
    },
    flowTitle: {
      en: "Toggle the modules. The flow rebuilds itself.",
      ar: "شغّل الوحدات التي تريدها، والمسار يعيد بناء نفسه أمامك."
    },
    flowNodes: {
      msg: {
        en: "New message",
        ar: "رسالة جديدة"
      },
      intent: {
        en: "AI understands intent",
        ar: "الذكاء الاصطناعي يفهم القصد"
      },
      answer: {
        en: "Sends the answer",
        ar: "يرسل الإجابة"
      },
      qualify: {
        en: "Qualifies the lead",
        ar: "يقيس جدية العميل"
      },
      book: {
        en: "Books the appointment",
        ar: "يحجز الموعد"
      },
      follow: {
        en: "Follows up",
        ar: "يتابع"
      },
      pay: {
        en: "Reminds about payment",
        ar: "يذكّر بالدفع"
      },
      report: {
        en: "Sends the report",
        ar: "يرسل التقرير"
      },
      human: {
        en: "Hands off to a human",
        ar: "يحوّل لموظف"
      }
    },
    always: {
      en: "always on",
      ar: "دائمًا"
    },
    teamEyebrow: {
      en: "Your AI team",
      ar: "فريقك الذكي"
    },
    teamTitle: {
      en: "Karam is not one bot. It is a team you assemble.",
      ar: "كرم ليس بوتًا واحدًا، بل فريق تختاره أنت."
    },
    bestFor: {
      en: "Best for",
      ar: "الأنسب لـ"
    },
    addTeam: {
      en: "Add to my AI team",
      ar: "أضف إلى فريقي"
    },
    added: {
      en: "On my team",
      ar: "في فريقي"
    },
    teamTray: {
      en: "agents on your team",
      ar: "وكلاء في فريقك"
    },
    teamTrayCta: {
      en: "Plan my team",
      ar: "خطّط فريقي"
    },
    roi: {
      msgs: {
        en: "Customer messages per day",
        ar: "رسائل العملاء يوميًا"
      },
      reply: {
        en: "Minutes per reply",
        ar: "دقائق لكل ردّ"
      },
      missed: {
        en: "Missed leads per week",
        ar: "عملاء ضائعون أسبوعيًا"
      },
      cost: {
        en: "Staff cost per hour (JD)",
        ar: "تكلفة الموظف بالساعة (دينار)"
      },
      hours: {
        en: "Hours saved per month",
        ar: "ساعات موفَّرة شهريًا"
      },
      recovered: {
        en: "Leads recovered per month",
        ar: "عملاء مستعادون شهريًا"
      },
      value: {
        en: "Value of that time",
        ar: "قيمة هذا الوقت"
      },
      first: {
        en: "Suggested first automation",
        ar: "أول أتمتة مقترحة"
      }
    },
    casesEyebrow: {
      en: "Use cases",
      ar: "حالات الاستخدام"
    },
    casesTitle: {
      en: "Built around your business, not a generic chatbot.",
      ar: "مبنيّ على عملك أنت، وليس بوتًا جاهزًا للجميع."
    },
    caseCols: {
      problem: {
        en: "Problem",
        ar: "المشكلة"
      },
      solution: {
        en: "Karam Bot",
        ar: "كرم بوت"
      },
      example: {
        en: "Example",
        ar: "مثال"
      },
      result: {
        en: "Result",
        ar: "النتيجة"
      }
    },
    demoEyebrow: {
      en: "Live demo",
      ar: "تجربة حيّة"
    },
    demoTitle: {
      en: "Pick what the customer says. Karam takes it from there.",
      ar: "اختر ما يقوله العميل، وشاهد كرم يكمل الباقي."
    },
    demoAgent: {
      en: "Karam · AI agent",
      ar: "كرم · وكيل ذكي"
    },
    typing: {
      en: "typing…",
      ar: "يكتب…"
    },
    online: {
      en: "online",
      ar: "متصل"
    },
    trustEyebrow: {
      en: "Built for real operations",
      ar: "مبنيّ للتشغيل الفعلي"
    },
    trustTitle: {
      en: "Automation you control, not a black box.",
      ar: "أتمتة تتحكّم بها أنت، لا صندوق أسود."
    },
    trust: [{
      icon: "UserRound",
      t: {
        en: "Human handoff, always",
        ar: "تحويل لموظف، دائمًا"
      },
      d: {
        en: "Any conversation can be handed to your team with full context. Karam never traps a customer.",
        ar: "أي محادثة يمكن تحويلها لفريقك مع السياق كاملًا. كرم لا يحاصر عميلًا أبدًا."
      }
    }, {
      icon: "Workflow",
      t: {
        en: "Works with your workflow",
        ar: "يعمل مع طريقتك"
      },
      d: {
        en: "Your prices, your hours, your rules. Nothing is invented on your behalf.",
        ar: "أسعارك، أوقاتك، قواعدك. لا شيء يُخترع نيابةً عنك."
      }
    }, {
      icon: "Plug",
      t: {
        en: "Connects to what you use",
        ar: "يتصل بما تستخدمه"
      },
      d: {
        en: "WhatsApp Cloud API, Google Sheets, calendar, CRM, dashboards, Make, Zapier, n8n.",
        ar: "واتساب Cloud API، جداول جوجل، التقويم، CRM، لوحات التحكم، Make وZapier وn8n."
      }
    }, {
      icon: "ShieldCheck",
      t: {
        en: "Secure and controlled",
        ar: "آمن ومضبوط"
      },
      d: {
        en: "Approve new answers before Karam uses them. Every action is logged.",
        ar: "تعتمد الردود الجديدة قبل أن يستخدمها كرم. كل إجراء مسجَّل."
      }
    }],
    form: {
      name: {
        en: "Your name",
        ar: "اسمك"
      },
      business: {
        en: "Business type",
        ar: "نوع النشاط"
      },
      phone: {
        en: "Phone / WhatsApp",
        ar: "الهاتف / واتساب"
      },
      want: {
        en: "What do you want to automate?",
        ar: "ما الذي تريد أتمتته؟"
      },
      wantPh: {
        en: "e.g. WhatsApp replies and table bookings",
        ar: "مثال: ردود واتساب وحجوزات الطاولات"
      },
      submit: {
        en: "Send on WhatsApp",
        ar: "أرسل عبر واتساب"
      },
      sent: {
        en: "Opening WhatsApp with your request…",
        ar: "يتم فتح واتساب مع طلبك…"
      }
    },
    taglines: [{
      en: "Your customers do not wait. Your AI agent should not either.",
      ar: "عملاؤك لا ينتظرون. ووكيلك الذكي لا ينبغي أن ينتظر."
    }, {
      en: "Reply, qualify, book, follow up, and report — automatically.",
      ar: "يردّ، يقيس، يحجز، يتابع، ويبلّغ، تلقائيًا."
    }, {
      en: "Turn messy conversations into organized business actions.",
      ar: "حوّل المحادثات الفوضوية إلى إجراءات عمل منظّمة."
    }],
    heroFeed: [{
      kind: "in",
      en: "Table for 4 tonight at 8?",
      ar: "طاولة لأربعة الليلة 8؟"
    }, {
      kind: "out",
      en: "Terrace or indoor? Both are free at 8.",
      ar: "تراس أم داخلي؟ كلاهما متاح الساعة 8."
    }, {
      kind: "in",
      en: "Terrace",
      ar: "تراس"
    }, {
      kind: "book",
      en: "Booking #4821 confirmed · Terrace · 8:00 pm",
      ar: "حجز 4821 مؤكّد · تراس · 8:00 مساءً"
    }, {
      kind: "owner",
      en: "Owner notified: new booking + 1 lead followed up",
      ar: "تم إبلاغ المالك: حجز جديد + متابعة عميل"
    }, {
      kind: "report",
      en: "Daily summary · 34 chats · 9 bookings · 2 need you",
      ar: "ملخص اليوم · 34 محادثة · 9 حجوزات · 2 تحتاجك"
    }]
  };
/**
 * @license lucide-react v0.294.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
var Ap = {
  xmlns: "http://www.w3.org/2000/svg",
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round"
};
/**
 * @license lucide-react v0.294.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Pp = e => e.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase().trim(),
  M = (e, t) => {
    const n = C.forwardRef(({
      color: r = "currentColor",
      size: l = 24,
      strokeWidth: a = 2,
      absoluteStrokeWidth: i,
      className: o = "",
      children: u,
      ...c
    }, g) => C.createElement("svg", {
      ref: g,
      ...Ap,
      width: l,
      height: l,
      stroke: r,
      strokeWidth: i ? Number(a) * 24 / Number(l) : a,
      className: ["lucide", `lucide-${Pp(e)}`, o].join(" "),
      ...c
    }, [...t.map(([p, h]) => C.createElement(p, h)), ...Array.isArray(u) ? u : [u]]));
    return n.displayName = `${e}`, n
  };
/**
 * @license lucide-react v0.294.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Tp = M("AlertCircle", [
  ["circle", {
    cx: "12",
    cy: "12",
    r: "10",
    key: "1mglay"
  }],
  ["line", {
    x1: "12",
    x2: "12",
    y1: "8",
    y2: "12",
    key: "1pkeuh"
  }],
  ["line", {
    x1: "12",
    x2: "12.01",
    y1: "16",
    y2: "16",
    key: "4dfq90"
  }]
]);
/**
 * @license lucide-react v0.294.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Mp = M("AlertTriangle", [
  ["path", {
    d: "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z",
    key: "c3ski4"
  }],
  ["path", {
    d: "M12 9v4",
    key: "juzpu7"
  }],
  ["path", {
    d: "M12 17h.01",
    key: "p32p05"
  }]
]);
/**
 * @license lucide-react v0.294.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Ip = M("ArrowLeft", [
  ["path", {
    d: "m12 19-7-7 7-7",
    key: "1l729n"
  }],
  ["path", {
    d: "M19 12H5",
    key: "x3x0zl"
  }]
]);
/**
 * @license lucide-react v0.294.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Lp = M("ArrowRight", [
  ["path", {
    d: "M5 12h14",
    key: "1ays0h"
  }],
  ["path", {
    d: "m12 5 7 7-7 7",
    key: "xquz4c"
  }]
]);
/**
 * @license lucide-react v0.294.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Rp = M("ArrowUpRight", [
  ["path", {
    d: "M7 7h10v10",
    key: "1tivn9"
  }],
  ["path", {
    d: "M7 17 17 7",
    key: "1vkiza"
  }]
]);
/**
 * @license lucide-react v0.294.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Fp = M("BarChart3", [
  ["path", {
    d: "M3 3v18h18",
    key: "1s2lah"
  }],
  ["path", {
    d: "M18 17V9",
    key: "2bz60n"
  }],
  ["path", {
    d: "M13 17V5",
    key: "1frdt8"
  }],
  ["path", {
    d: "M8 17v-3",
    key: "17ska0"
  }]
]);
/**
 * @license lucide-react v0.294.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const zp = M("BellOff", [
  ["path", {
    d: "M8.7 3A6 6 0 0 1 18 8a21.3 21.3 0 0 0 .6 5",
    key: "o7mx20"
  }],
  ["path", {
    d: "M17 17H3s3-2 3-9a4.67 4.67 0 0 1 .3-1.7",
    key: "16f1lm"
  }],
  ["path", {
    d: "M10.3 21a1.94 1.94 0 0 0 3.4 0",
    key: "qgo35s"
  }],
  ["path", {
    d: "m2 2 20 20",
    key: "1ooewy"
  }]
]);
/**
 * @license lucide-react v0.294.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Dp = M("BellRing", [
  ["path", {
    d: "M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9",
    key: "1qo2s2"
  }],
  ["path", {
    d: "M10.3 21a1.94 1.94 0 0 0 3.4 0",
    key: "qgo35s"
  }],
  ["path", {
    d: "M4 2C2.8 3.7 2 5.7 2 8",
    key: "tap9e0"
  }],
  ["path", {
    d: "M22 8c0-2.3-.8-4.3-2-6",
    key: "5bb3ad"
  }]
]);
/**
 * @license lucide-react v0.294.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const _p = M("Bot", [
  ["path", {
    d: "M12 8V4H8",
    key: "hb8ula"
  }],
  ["rect", {
    width: "16",
    height: "12",
    x: "4",
    y: "8",
    rx: "2",
    key: "enze0r"
  }],
  ["path", {
    d: "M2 14h2",
    key: "vft8re"
  }],
  ["path", {
    d: "M20 14h2",
    key: "4cs60a"
  }],
  ["path", {
    d: "M15 13v2",
    key: "1xurst"
  }],
  ["path", {
    d: "M9 13v2",
    key: "rq6x2g"
  }]
]);
/**
 * @license lucide-react v0.294.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Bp = M("Brain", [
  ["path", {
    d: "M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z",
    key: "1mhkh5"
  }],
  ["path", {
    d: "M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z",
    key: "1d6s00"
  }]
]);
/**
 * @license lucide-react v0.294.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Op = M("Briefcase", [
  ["rect", {
    width: "20",
    height: "14",
    x: "2",
    y: "7",
    rx: "2",
    ry: "2",
    key: "eto64e"
  }],
  ["path", {
    d: "M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16",
    key: "zwj3tp"
  }]
]);
/**
 * @license lucide-react v0.294.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Wp = M("Building2", [
  ["path", {
    d: "M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z",
    key: "1b4qmf"
  }],
  ["path", {
    d: "M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2",
    key: "i71pzd"
  }],
  ["path", {
    d: "M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2",
    key: "10jefs"
  }],
  ["path", {
    d: "M10 6h4",
    key: "1itunk"
  }],
  ["path", {
    d: "M10 10h4",
    key: "tcdvrf"
  }],
  ["path", {
    d: "M10 14h4",
    key: "kelpxr"
  }],
  ["path", {
    d: "M10 18h4",
    key: "1ulq68"
  }]
]);
/**
 * @license lucide-react v0.294.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Up = M("CalendarCheck", [
  ["rect", {
    width: "18",
    height: "18",
    x: "3",
    y: "4",
    rx: "2",
    ry: "2",
    key: "eu3xkr"
  }],
  ["line", {
    x1: "16",
    x2: "16",
    y1: "2",
    y2: "6",
    key: "m3sa8f"
  }],
  ["line", {
    x1: "8",
    x2: "8",
    y1: "2",
    y2: "6",
    key: "18kwsl"
  }],
  ["line", {
    x1: "3",
    x2: "21",
    y1: "10",
    y2: "10",
    key: "xt86sb"
  }],
  ["path", {
    d: "m9 16 2 2 4-4",
    key: "19s6y9"
  }]
]);
/**
 * @license lucide-react v0.294.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Hp = M("CheckCircle2", [
  ["circle", {
    cx: "12",
    cy: "12",
    r: "10",
    key: "1mglay"
  }],
  ["path", {
    d: "m9 12 2 2 4-4",
    key: "dzmm74"
  }]
]);
/**
 * @license lucide-react v0.294.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Vp = M("Check", [
  ["path", {
    d: "M20 6 9 17l-5-5",
    key: "1gmf2c"
  }]
]);
/**
 * @license lucide-react v0.294.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const $p = M("ClipboardCheck", [
  ["rect", {
    width: "8",
    height: "4",
    x: "8",
    y: "2",
    rx: "1",
    ry: "1",
    key: "tgr4d6"
  }],
  ["path", {
    d: "M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2",
    key: "116196"
  }],
  ["path", {
    d: "m9 14 2 2 4-4",
    key: "df797q"
  }]
]);
/**
 * @license lucide-react v0.294.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Kp = M("ClipboardList", [
  ["rect", {
    width: "8",
    height: "4",
    x: "8",
    y: "2",
    rx: "1",
    ry: "1",
    key: "tgr4d6"
  }],
  ["path", {
    d: "M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2",
    key: "116196"
  }],
  ["path", {
    d: "M12 11h4",
    key: "1jrz19"
  }],
  ["path", {
    d: "M12 16h4",
    key: "n85exb"
  }],
  ["path", {
    d: "M8 11h.01",
    key: "1dfujw"
  }],
  ["path", {
    d: "M8 16h.01",
    key: "18s6g9"
  }]
]);
/**
 * @license lucide-react v0.294.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Yp = M("Clock", [
  ["circle", {
    cx: "12",
    cy: "12",
    r: "10",
    key: "1mglay"
  }],
  ["polyline", {
    points: "12 6 12 12 16 14",
    key: "68esgv"
  }]
]);
/**
 * @license lucide-react v0.294.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const qp = M("Coins", [
  ["circle", {
    cx: "8",
    cy: "8",
    r: "6",
    key: "3yglwk"
  }],
  ["path", {
    d: "M18.09 10.37A6 6 0 1 1 10.34 18",
    key: "t5s6rm"
  }],
  ["path", {
    d: "M7 6h1v4",
    key: "1obek4"
  }],
  ["path", {
    d: "m16.71 13.88.7.71-2.82 2.82",
    key: "1rbuyh"
  }]
]);
/**
 * @license lucide-react v0.294.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Qp = M("CreditCard", [
  ["rect", {
    width: "20",
    height: "14",
    x: "2",
    y: "5",
    rx: "2",
    key: "ynyp8z"
  }],
  ["line", {
    x1: "2",
    x2: "22",
    y1: "10",
    y2: "10",
    key: "1b3vmo"
  }]
]);
/**
 * @license lucide-react v0.294.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Gp = M("FileBarChart", [
  ["path", {
    d: "M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z",
    key: "1nnpy2"
  }],
  ["polyline", {
    points: "14 2 14 8 20 8",
    key: "1ew0cm"
  }],
  ["path", {
    d: "M12 18v-4",
    key: "q1q25u"
  }],
  ["path", {
    d: "M8 18v-2",
    key: "qcmpov"
  }],
  ["path", {
    d: "M16 18v-6",
    key: "15y0np"
  }]
]);
/**
 * @license lucide-react v0.294.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Zp = M("Globe", [
  ["circle", {
    cx: "12",
    cy: "12",
    r: "10",
    key: "1mglay"
  }],
  ["path", {
    d: "M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20",
    key: "13o1zl"
  }],
  ["path", {
    d: "M2 12h20",
    key: "9i4pu4"
  }]
]);
/**
 * @license lucide-react v0.294.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Jp = M("Headphones", [
  ["path", {
    d: "M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3",
    key: "1xhozi"
  }]
]);
/**
 * @license lucide-react v0.294.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Xp = M("Inbox", [
  ["polyline", {
    points: "22 12 16 12 14 15 10 15 8 12 2 12",
    key: "o97t9d"
  }],
  ["path", {
    d: "M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z",
    key: "oot6mr"
  }]
]);
/**
 * @license lucide-react v0.294.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const em = M("Instagram", [
  ["rect", {
    width: "20",
    height: "20",
    x: "2",
    y: "2",
    rx: "5",
    ry: "5",
    key: "2e1cvw"
  }],
  ["path", {
    d: "M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z",
    key: "9exkf1"
  }],
  ["line", {
    x1: "17.5",
    x2: "17.51",
    y1: "6.5",
    y2: "6.5",
    key: "r4j83e"
  }]
]);
/**
 * @license lucide-react v0.294.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const tm = M("Layers", [
  ["path", {
    d: "m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z",
    key: "8b97xw"
  }],
  ["path", {
    d: "m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65",
    key: "dd6zsq"
  }],
  ["path", {
    d: "m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65",
    key: "ep9fru"
  }]
]);
/**
 * @license lucide-react v0.294.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const nm = M("LifeBuoy", [
  ["circle", {
    cx: "12",
    cy: "12",
    r: "10",
    key: "1mglay"
  }],
  ["path", {
    d: "m4.93 4.93 4.24 4.24",
    key: "1ymg45"
  }],
  ["path", {
    d: "m14.83 9.17 4.24-4.24",
    key: "1cb5xl"
  }],
  ["path", {
    d: "m14.83 14.83 4.24 4.24",
    key: "q42g0n"
  }],
  ["path", {
    d: "m9.17 14.83-4.24 4.24",
    key: "bqpfvv"
  }],
  ["circle", {
    cx: "12",
    cy: "12",
    r: "4",
    key: "4exip2"
  }]
]);
/**
 * @license lucide-react v0.294.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const rm = M("Lock", [
  ["rect", {
    width: "18",
    height: "11",
    x: "3",
    y: "11",
    rx: "2",
    ry: "2",
    key: "1w4ew1"
  }],
  ["path", {
    d: "M7 11V7a5 5 0 0 1 10 0v4",
    key: "fwvmzm"
  }]
]);
/**
 * @license lucide-react v0.294.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const lm = M("MapPin", [
  ["path", {
    d: "M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z",
    key: "2oe9fu"
  }],
  ["circle", {
    cx: "12",
    cy: "10",
    r: "3",
    key: "ilqhr7"
  }]
]);
/**
 * @license lucide-react v0.294.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const am = M("MessageCircle", [
  ["path", {
    d: "m3 21 1.9-5.7a8.5 8.5 0 1 1 3.8 3.8z",
    key: "v2veuj"
  }]
]);
/**
 * @license lucide-react v0.294.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const sm = M("MessageSquare", [
  ["path", {
    d: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
    key: "1lielz"
  }]
]);
/**
 * @license lucide-react v0.294.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const im = M("MousePointerClick", [
  ["path", {
    d: "m9 9 5 12 1.8-5.2L21 14Z",
    key: "1b76lo"
  }],
  ["path", {
    d: "M7.2 2.2 8 5.1",
    key: "1cfko1"
  }],
  ["path", {
    d: "m5.1 8-2.9-.8",
    key: "1go3kf"
  }],
  ["path", {
    d: "M14 4.1 12 6",
    key: "ita8i4"
  }],
  ["path", {
    d: "m6 12-1.9 2",
    key: "mnht97"
  }]
]);
/**
 * @license lucide-react v0.294.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const om = M("PartyPopper", [
  ["path", {
    d: "M5.8 11.3 2 22l10.7-3.79",
    key: "gwxi1d"
  }],
  ["path", {
    d: "M4 3h.01",
    key: "1vcuye"
  }],
  ["path", {
    d: "M22 8h.01",
    key: "1mrtc2"
  }],
  ["path", {
    d: "M15 2h.01",
    key: "1cjtqr"
  }],
  ["path", {
    d: "M22 20h.01",
    key: "1mrys2"
  }],
  ["path", {
    d: "m22 2-2.24.75a2.9 2.9 0 0 0-1.96 3.12v0c.1.86-.57 1.63-1.45 1.63h-.38c-.86 0-1.6.6-1.76 1.44L14 10",
    key: "bpx1uq"
  }],
  ["path", {
    d: "m22 13-.82-.33c-.86-.34-1.82.2-1.98 1.11v0c-.11.7-.72 1.22-1.43 1.22H17",
    key: "1pd0s7"
  }],
  ["path", {
    d: "m11 2 .33.82c.34.86-.2 1.82-1.11 1.98v0C9.52 4.9 9 5.52 9 6.23V7",
    key: "zq5xbz"
  }],
  ["path", {
    d: "M11 13c1.93 1.93 2.83 4.17 2 5-.83.83-3.07-.07-5-2-1.93-1.93-2.83-4.17-2-5 .83-.83 3.07.07 5 2Z",
    key: "4kbmks"
  }]
]);
/**
 * @license lucide-react v0.294.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const um = M("PenLine", [
  ["path", {
    d: "M12 20h9",
    key: "t2du7b"
  }],
  ["path", {
    d: "M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z",
    key: "ymcmye"
  }]
]);
/**
 * @license lucide-react v0.294.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const cm = M("Percent", [
  ["line", {
    x1: "19",
    x2: "5",
    y1: "5",
    y2: "19",
    key: "1x9vlm"
  }],
  ["circle", {
    cx: "6.5",
    cy: "6.5",
    r: "2.5",
    key: "4mh3h7"
  }],
  ["circle", {
    cx: "17.5",
    cy: "17.5",
    r: "2.5",
    key: "1mdrzq"
  }]
]);
/**
 * @license lucide-react v0.294.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const dm = M("Phone", [
  ["path", {
    d: "M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z",
    key: "foiqr5"
  }]
]);
/**
 * @license lucide-react v0.294.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const fm = M("Play", [
  ["polygon", {
    points: "5 3 19 12 5 21 5 3",
    key: "191637"
  }]
]);
/**
 * @license lucide-react v0.294.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const pm = M("Plug", [
  ["path", {
    d: "M12 22v-5",
    key: "1ega77"
  }],
  ["path", {
    d: "M9 8V2",
    key: "14iosj"
  }],
  ["path", {
    d: "M15 8V2",
    key: "18g5xt"
  }],
  ["path", {
    d: "M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z",
    key: "osxo6l"
  }]
]);
/**
 * @license lucide-react v0.294.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const mm = M("Plus", [
  ["path", {
    d: "M5 12h14",
    key: "1ays0h"
  }],
  ["path", {
    d: "M12 5v14",
    key: "s699le"
  }]
]);
/**
 * @license lucide-react v0.294.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const hm = M("Quote", [
  ["path", {
    d: "M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z",
    key: "4rm80e"
  }],
  ["path", {
    d: "M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z",
    key: "10za9r"
  }]
]);
/**
 * @license lucide-react v0.294.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const gm = M("Repeat", [
  ["path", {
    d: "m17 2 4 4-4 4",
    key: "nntrym"
  }],
  ["path", {
    d: "M3 11v-1a4 4 0 0 1 4-4h14",
    key: "84bu3i"
  }],
  ["path", {
    d: "m7 22-4-4 4-4",
    key: "1wqhfi"
  }],
  ["path", {
    d: "M21 13v1a4 4 0 0 1-4 4H3",
    key: "1rx37r"
  }]
]);
/**
 * @license lucide-react v0.294.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const ym = M("RotateCcw", [
  ["path", {
    d: "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8",
    key: "1357e3"
  }],
  ["path", {
    d: "M3 3v5h5",
    key: "1xhq8a"
  }]
]);
/**
 * @license lucide-react v0.294.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const vm = M("Scissors", [
  ["circle", {
    cx: "6",
    cy: "6",
    r: "3",
    key: "1lh9wr"
  }],
  ["path", {
    d: "M8.12 8.12 12 12",
    key: "1alkpv"
  }],
  ["path", {
    d: "M20 4 8.12 15.88",
    key: "xgtan2"
  }],
  ["circle", {
    cx: "6",
    cy: "18",
    r: "3",
    key: "fqmcym"
  }],
  ["path", {
    d: "M14.8 14.8 20 20",
    key: "ptml3r"
  }]
]);
/**
 * @license lucide-react v0.294.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const xm = M("Send", [
  ["path", {
    d: "m22 2-7 20-4-9-9-4Z",
    key: "1q3vgg"
  }],
  ["path", {
    d: "M22 2 11 13",
    key: "nzbqef"
  }]
]);
/**
 * @license lucide-react v0.294.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const km = M("ShieldCheck", [
  ["path", {
    d: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10",
    key: "1irkt0"
  }],
  ["path", {
    d: "m9 12 2 2 4-4",
    key: "dzmm74"
  }]
]);
/**
 * @license lucide-react v0.294.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const wm = M("Sparkles", [
  ["path", {
    d: "m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z",
    key: "17u4zn"
  }],
  ["path", {
    d: "M5 3v4",
    key: "bklmnn"
  }],
  ["path", {
    d: "M19 17v4",
    key: "iiml17"
  }],
  ["path", {
    d: "M3 5h4",
    key: "nem4j1"
  }],
  ["path", {
    d: "M17 19h4",
    key: "lbex7p"
  }]
]);
/**
 * @license lucide-react v0.294.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const jm = M("Stethoscope", [
  ["path", {
    d: "M4.8 2.3A.3.3 0 1 0 5 2H4a2 2 0 0 0-2 2v5a6 6 0 0 0 6 6v0a6 6 0 0 0 6-6V4a2 2 0 0 0-2-2h-1a.2.2 0 1 0 .3.3",
    key: "1jd90r"
  }],
  ["path", {
    d: "M8 15v1a6 6 0 0 0 6 6v0a6 6 0 0 0 6-6v-4",
    key: "126ukv"
  }],
  ["circle", {
    cx: "20",
    cy: "10",
    r: "2",
    key: "ts1r5v"
  }]
]);
/**
 * @license lucide-react v0.294.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Nm = M("Tag", [
  ["path", {
    d: "M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z",
    key: "14b2ls"
  }],
  ["path", {
    d: "M7 7h.01",
    key: "7u93v4"
  }]
]);
/**
 * @license lucide-react v0.294.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Sm = M("TrendingUp", [
  ["polyline", {
    points: "22 7 13.5 15.5 8.5 10.5 2 17",
    key: "126l90"
  }],
  ["polyline", {
    points: "16 7 22 7 22 13",
    key: "kwv8wd"
  }]
]);
/**
 * @license lucide-react v0.294.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const bm = M("Trophy", [
  ["path", {
    d: "M6 9H4.5a2.5 2.5 0 0 1 0-5H6",
    key: "17hqa7"
  }],
  ["path", {
    d: "M18 9h1.5a2.5 2.5 0 0 0 0-5H18",
    key: "lmptdp"
  }],
  ["path", {
    d: "M4 22h16",
    key: "57wxv0"
  }],
  ["path", {
    d: "M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22",
    key: "1nw9bq"
  }],
  ["path", {
    d: "M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22",
    key: "1np0yb"
  }],
  ["path", {
    d: "M18 2H6v7a6 6 0 0 0 12 0V2Z",
    key: "u46fv3"
  }]
]);
/**
 * @license lucide-react v0.294.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Cm = M("UserPlus", [
  ["path", {
    d: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2",
    key: "1yyitq"
  }],
  ["circle", {
    cx: "9",
    cy: "7",
    r: "4",
    key: "nufk8"
  }],
  ["line", {
    x1: "19",
    x2: "19",
    y1: "8",
    y2: "14",
    key: "1bvyxn"
  }],
  ["line", {
    x1: "22",
    x2: "16",
    y1: "11",
    y2: "11",
    key: "1shjgl"
  }]
]);
/**
 * @license lucide-react v0.294.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Em = M("UserRound", [
  ["circle", {
    cx: "12",
    cy: "8",
    r: "5",
    key: "1hypcn"
  }],
  ["path", {
    d: "M20 21a8 8 0 0 0-16 0",
    key: "rfgkzh"
  }]
]);
/**
 * @license lucide-react v0.294.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Am = M("UserX", [
  ["path", {
    d: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2",
    key: "1yyitq"
  }],
  ["circle", {
    cx: "9",
    cy: "7",
    r: "4",
    key: "nufk8"
  }],
  ["line", {
    x1: "17",
    x2: "22",
    y1: "8",
    y2: "13",
    key: "3nzzx3"
  }],
  ["line", {
    x1: "22",
    x2: "17",
    y1: "8",
    y2: "13",
    key: "1swrse"
  }]
]);
/**
 * @license lucide-react v0.294.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Pm = M("Users", [
  ["path", {
    d: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2",
    key: "1yyitq"
  }],
  ["circle", {
    cx: "9",
    cy: "7",
    r: "4",
    key: "nufk8"
  }],
  ["path", {
    d: "M22 21v-2a4 4 0 0 0-3-3.87",
    key: "kshegd"
  }],
  ["path", {
    d: "M16 3.13a4 4 0 0 1 0 7.75",
    key: "1da9ce"
  }]
]);
/**
 * @license lucide-react v0.294.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Tm = M("UtensilsCrossed", [
  ["path", {
    d: "m16 2-2.3 2.3a3 3 0 0 0 0 4.2l1.8 1.8a3 3 0 0 0 4.2 0L22 8",
    key: "n7qcjb"
  }],
  ["path", {
    d: "M15 15 3.3 3.3a4.2 4.2 0 0 0 0 6l7.3 7.3c.7.7 2 .7 2.8 0L15 15Zm0 0 7 7",
    key: "d0u48b"
  }],
  ["path", {
    d: "m2.1 21.8 6.4-6.3",
    key: "yn04lh"
  }],
  ["path", {
    d: "m19 5-7 7",
    key: "194lzd"
  }]
]);
/**
 * @license lucide-react v0.294.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Mm = M("Wand2", [
  ["path", {
    d: "m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72Z",
    key: "1bcowg"
  }],
  ["path", {
    d: "m14 7 3 3",
    key: "1r5n42"
  }],
  ["path", {
    d: "M5 6v4",
    key: "ilb8ba"
  }],
  ["path", {
    d: "M19 14v4",
    key: "blhpug"
  }],
  ["path", {
    d: "M10 2v2",
    key: "7u0qdc"
  }],
  ["path", {
    d: "M7 8H3",
    key: "zfb6yr"
  }],
  ["path", {
    d: "M21 16h-4",
    key: "1cnmox"
  }],
  ["path", {
    d: "M11 3H9",
    key: "1obp7u"
  }]
]);
/**
 * @license lucide-react v0.294.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Im = M("Workflow", [
  ["rect", {
    width: "8",
    height: "8",
    x: "3",
    y: "3",
    rx: "2",
    key: "by2w9f"
  }],
  ["path", {
    d: "M7 11v4a2 2 0 0 0 2 2h4",
    key: "xkn7yn"
  }],
  ["rect", {
    width: "8",
    height: "8",
    x: "13",
    y: "13",
    rx: "2",
    key: "1cgmvn"
  }]
]);
/**
 * @license lucide-react v0.294.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Lm = M("Zap", [
    ["polygon", {
      points: "13 2 3 14 12 14 11 22 21 10 12 10 13 2",
      key: "45s27k"
    }]
  ]),
  ks = {
    AlertCircle: Tp,
    AlertTriangle: Mp,
    ArrowLeft: Ip,
    ArrowRight: Lp,
    ArrowUpRight: Rp,
    BarChart3: Fp,
    BellOff: zp,
    BellRing: Dp,
    Bot: _p,
    Brain: Bp,
    Briefcase: Op,
    Building2: Wp,
    CalendarCheck: Up,
    Check: Vp,
    CheckCircle2: Hp,
    ClipboardCheck: $p,
    ClipboardList: Kp,
    Clock: Yp,
    Coins: qp,
    CreditCard: Qp,
    FileBarChart: Gp,
    Globe: Zp,
    Headphones: Jp,
    Inbox: Xp,
    Instagram: em,
    Layers: tm,
    LifeBuoy: nm,
    Lock: rm,
    MapPin: lm,
    MessageCircle: am,
    MessageSquare: sm,
    Quote: hm,
    MousePointerClick: im,
    PartyPopper: om,
    PenLine: um,
    Percent: cm,
    Phone: dm,
    Play: fm,
    Plug: pm,
    Plus: mm,
    Repeat: gm,
    RotateCcw: ym,
    Scissors: vm,
    Send: xm,
    ShieldCheck: km,
    Sparkles: wm,
    Stethoscope: jm,
    Tag: Nm,
    TrendingUp: Sm,
    Trophy: bm,
    UserPlus: Cm,
    UserRound: Em,
    UserX: Am,
    Users: Pm,
    UtensilsCrossed: Tm,
    Wand2: Mm,
    Workflow: Im,
    Zap: Lm
  };

function I({
  name: e,
  className: t = "w-5 h-5",
  strokeWidth: n = 2
}) {
  const r = ks[e] || ks.Sparkles;
  return s.jsx(r, {
    className: t,
    strokeWidth: n,
    "aria-hidden": "true"
  })
}

function ze({
  id: e,
  className: t = "",
  children: n,
  tone: r = "light"
}) {
  const l = {
    light: "bg-[var(--kb-ground)] text-[var(--kb-ink)]",
    white: "bg-[var(--kb-surface)] text-[var(--kb-ink)]",
    dark: "bg-[var(--kb-ink)] text-white"
  };
  return s.jsx("section", {
    id: e,
    className: `kb-section ${l[r]} ${t}`,
    children: s.jsx("div", {
      className: "kb-container",
      children: n
    })
  })
}

function Ke({
  children: e,
  tone: t = "light"
}) {
  return s.jsx("p", {
    className: `kb-eyebrow ${t==="dark"?"text-[var(--kb-signal)]":"text-[var(--kb-electric)]"}`,
    children: e
  })
}

function Ye({
  children: e,
  tone: t = "light",
  className: n = ""
}) {
  return s.jsx("h2", {
    className: `kb-h2 ${t==="dark"?"text-white":"text-[var(--kb-ink)]"} ${n}`,
    children: e
  })
}

function W({
  variant: e = "primary",
  size: t = "md",
  href: n,
  onClick: r,
  children: l,
  icon: a,
  className: i = "",
  type: o = "button",
  ...u
}) {
  const c = "kb-btn inline-flex items-center justify-center gap-2 font-semibold rounded-full transition-all focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--kb-electric)]/30 active:scale-[0.98]",
    g = {
      sm: "h-10 px-4 text-sm",
      md: "h-12 px-6 text-base",
      lg: "h-14 px-8 text-lg"
    },
    p = {
      primary: "bg-[var(--kb-electric)] text-white hover:bg-[#175ae0] shadow-[0_10px_30px_-10px_rgba(31,107,255,.6)]",
      gold: "bg-[var(--kb-gold)] text-[var(--kb-ink)] hover:bg-[#f5c05a] shadow-[0_10px_30px_-10px_rgba(242,179,61,.6)]",
      ghost: "bg-transparent text-[var(--kb-ink)] border border-[var(--kb-line)] hover:border-[var(--kb-ink)]",
      ghostDark: "bg-white/10 text-white border border-white/20 hover:bg-white/15",
      wa: "bg-[#25D366] text-[#062b1a] hover:bg-[#1fc15a]"
    },
    h = `${c} ${g[t]} ${p[e]} ${i}`;
  return n ? s.jsxs("a", {
    href: n,
    className: h,
    onClick: r,
    ...u,
    children: [a && s.jsx(I, {
      name: a,
      className: "w-5 h-5"
    }), l]
  }) : s.jsxs("button", {
    type: o,
    className: h,
    onClick: r,
    ...u,
    children: [a && s.jsx(I, {
      name: a,
      className: "w-5 h-5"
    }), l]
  })
}

function Sn({
  selected: e,
  onClick: t,
  icon: n,
  children: r,
  className: l = "",
  size: a = "md"
}) {
  return s.jsxs("button", {
    type: "button",
    role: "radio",
    "aria-checked": e,
    onClick: t,
    className: `kb-option ${e?"is-selected":""} ${a==="sm"?"kb-option-sm":""} ${l}`,
    children: [n && s.jsx("span", {
      className: "kb-option-icon",
      children: s.jsx(I, {
        name: n,
        className: "w-5 h-5"
      })
    }), s.jsx("span", {
      children: r
    }), e && s.jsx(ks.Check, {
      className: "w-4 h-4 ms-auto shrink-0",
      "aria-hidden": "true"
    })]
  })
}

function $c({
  value: e,
  prefix: t = "",
  suffix: n = "",
  decimals: r = 0,
  duration: l = 1100,
  className: a = ""
}) {
  const i = C.useRef(null),
    [o, u] = C.useState(0),
    c = typeof window < "u" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return C.useEffect(() => {
    if (c) {
      u(e);
      return
    }
    const g = i.current;
    if (!g) return;
    let p, h = !1;
    const v = () => {
        const w = performance.now(),
          _ = o,
          f = e,
          d = m => {
            const x = Math.min(1, (m - w) / l),
              S = 1 - Math.pow(1 - x, 3);
            u(_ + (f - _) * S), x < 1 && (p = requestAnimationFrame(d))
          };
        p = requestAnimationFrame(d)
      },
      k = new IntersectionObserver(w => {
        w[0].isIntersecting && !h && (h = !0, v(), k.disconnect())
      }, {
        threshold: .4
      });
    return k.observe(g), () => {
      k.disconnect(), cancelAnimationFrame(p)
    }
  }, [e]), s.jsxs("span", {
    ref: i,
    className: `tabular-nums ${a}`,
    children: [t, Number(o).toFixed(r), n]
  })
}

function Rm({
  children: e,
  className: t = "",
  delay: n = 0
}) {
  const r = C.useRef(null),
    [l, a] = C.useState(!1);
  return C.useEffect(() => {
    const i = r.current;
    if (!i) return;
    const o = new IntersectionObserver(u => {
      u[0].isIntersecting && (a(!0), o.disconnect())
    }, {
      threshold: .15
    });
    return o.observe(i), () => o.disconnect()
  }, []), s.jsx("div", {
    ref: r,
    className: `kb-reveal ${l?"is-in":""} ${t}`,
    style: {
      transitionDelay: `${n}ms`
    },
    children: e
  })
}

function Fm({
  tone: e = "light"
}) {
  const {
    lang: t,
    setLang: n
  } = V();
  return s.jsxs("div", {
    className: `kb-lang ${e==="dark"?"kb-lang-dark":""}`,
    role: "group",
    "aria-label": "اللغة / Language",
    children: [s.jsx("button", {
      type: "button",
      "aria-pressed": t === "ar",
      className: t === "ar" ? "is-on" : "",
      onClick: () => n("ar"),
      children: "عربي"
    }), s.jsx("button", {
      type: "button",
      "aria-pressed": t === "en",
      className: t === "en" ? "is-on" : "",
      onClick: () => n("en"),
      children: "EN"
    })]
  })
}

function Nr({
  size: e = 40,
  className: t = ""
}) {
  return s.jsx("span", {
    className: `kb-avatar ${t}`,
    style: {
      width: e,
      height: e
    },
    "aria-hidden": "true",
    children: s.jsxs("svg", {
      viewBox: "0 0 40 40",
      width: e,
      height: e,
      children: [s.jsx("circle", {
        cx: "20",
        cy: "20",
        r: "20",
        fill: "#F2B33D"
      }), s.jsx("path", {
        d: "M11 27 L11 13 L15 13 L15 19 L21 13 L26 13 L19 20 L27 27 L21.5 27 L15 20.5 L15 27 Z",
        fill: "#0F1E38"
      }), s.jsx("circle", {
        cx: "30",
        cy: "10",
        r: "4",
        fill: "#22D3EE"
      })]
    })
  })
}

function gr(e) {
  const t = document.getElementById(e);
  t && t.scrollIntoView({
    behavior: "smooth",
    block: "start"
  })
}
const zm = {
  business: "restaurant",
  role: "sales",
  channel: "whatsapp",
  pain: "slow"
};

function Dm(e, t) {
  const n = p => p && typeof p == "object" ? p[t] ?? p.en : p,
    r = Ce.find(p => p.id === e.business) || Ce[0],
    l = mr.find(p => p.id === e.role) || mr[0],
    a = hr.find(p => p.id === e.channel) || hr[0],
    i = xs.find(p => p.id === e.pain) || xs[0],
    o = {
      unit: n(r.unit),
      noun: n(r.noun)
    },
    u = (Sp[l.id] || []).map(p => Np(n(p), o)),
    c = a.id === "multi" ? t === "ar" ? "عبر كل قنواتك" : "across every channel you use" : t === "ar" ? `عبر ${n(a.label)}` : `on ${n(a.label)}`,
    g = t === "ar" ? `تعرّف على كرم، ${n(l.label)} لـ${n(r.label)}. ${n(l.does)} ${c}، ويعالج مشكلة "${n(i.label)}" أولًا.` : `Meet Karam, your ${n(l.label)} for ${n(r.label).toLowerCase()}. It ${n(l.does)} It works ${c} and tackles "${n(i.label).toLowerCase()}" first.`;
  return {
    b: r,
    r: l,
    c: a,
    p: i,
    tasks: u,
    summary: g
  }
}

function _m({
  selection: e,
  compact: t = !1
}) {
  const {
    lang: n,
    t: r
  } = V(), l = Dm(e, n), a = encodeURIComponent(n === "ar" ? `مرحبًا شِفت، أريد خطة كرم بوت لوكيل: ${r(l.r.label)} لـ${r(l.b.label)} عبر ${r(l.c.label)}. أكبر مشكلة: ${r(l.p.label)}.` : `Hi SHIFT, I want a Karam Bot plan for: ${r(l.r.label)} for a ${r(l.b.label)} on ${r(l.c.label)}. Biggest pain: ${r(l.p.label)}.`);
  return s.jsxs("article", {
    className: `kb-agent-card kb-card-enter ${t?"p-5":"p-6 md:p-8"}`,
    "aria-live": "polite",
    children: [s.jsx("div", {
      className: "kb-seal",
      children: n === "ar" ? "جاهز خلال 60 ثانية" : "BUILT IN 60 SEC"
    }), s.jsxs("div", {
      className: "flex items-center gap-3 mb-4",
      children: [s.jsx(Nr, {
        size: 48
      }), s.jsxs("div", {
        children: [s.jsx("p", {
          className: "text-xs font-bold uppercase tracking-wider text-[var(--kb-muted)]",
          children: r(N.cardRole)
        }), s.jsx("h3", {
          className: "kb-display text-xl md:text-2xl font-extrabold leading-tight",
          children: r(l.r.label)
        })]
      })]
    }), s.jsx("p", {
      className: "text-[15px] md:text-base leading-relaxed text-[var(--kb-ink-2)]",
      children: l.summary
    }), s.jsxs("div", {
      className: `grid gap-5 mt-6 ${t?"":"md:grid-cols-2"}`,
      children: [s.jsxs("div", {
        children: [s.jsx("p", {
          className: "text-xs font-bold uppercase tracking-wider text-[var(--kb-muted)] mb-2",
          children: r(N.cardTasks)
        }), s.jsx("ul", {
          className: "space-y-2",
          children: l.tasks.map((i, o) => s.jsxs("li", {
            className: "flex gap-2 text-sm text-[var(--kb-ink-2)]",
            children: [s.jsx(I, {
              name: "CheckCircle2",
              className: "w-4 h-4 mt-0.5 text-[var(--kb-ok)] shrink-0"
            }), s.jsx("span", {
              children: i
            })]
          }, o))
        })]
      }), s.jsxs("div", {
        children: [s.jsx("p", {
          className: "text-xs font-bold uppercase tracking-wider text-[var(--kb-muted)] mb-2",
          children: r(N.cardImpact)
        }), s.jsxs("div", {
          className: "rounded-2xl bg-[var(--kb-ground)] p-4",
          children: [s.jsx("div", {
            className: "kb-display text-4xl font-extrabold text-[var(--kb-electric)] tabular-nums",
            children: s.jsx($c, {
              value: l.p.metric.value,
              suffix: r(l.p.metric.suffix)
            })
          }), s.jsx("p", {
            className: "text-sm font-semibold mt-1",
            children: r(l.p.metric.label)
          }), s.jsxs("p", {
            className: "text-xs text-[var(--kb-muted)] mt-2",
            children: [r(l.p.impact), " · ", r(N.typical)]
          })]
        }), s.jsxs("div", {
          className: "flex flex-wrap gap-2 mt-3 text-xs font-semibold",
          children: [s.jsxs("span", {
            className: "px-2.5 py-1 rounded-full bg-[var(--kb-gold-soft)] text-[#7A4B00]",
            children: [s.jsx(I, {
              name: l.b.icon,
              className: "w-3.5 h-3.5 inline me-1"
            }), r(l.b.label)]
          }), s.jsxs("span", {
            className: "px-2.5 py-1 rounded-full bg-[var(--kb-electric-soft)] text-[var(--kb-electric)]",
            children: [s.jsx(I, {
              name: l.c.icon,
              className: "w-3.5 h-3.5 inline me-1"
            }), r(l.c.label)]
          })]
        })]
      })]
    }), s.jsxs("div", {
      className: "mt-6 flex flex-col sm:flex-row gap-3",
      children: [s.jsx(W, {
        variant: "primary",
        href: `https://wa.me/${He}?text=${a}`,
        target: "_blank",
        rel: "noopener",
        icon: "Sparkles",
        children: r(N.ctaPlan)
      }), s.jsx(W, {
        variant: "ghost",
        href: "#contact",
        icon: "MessageCircle",
        children: r(N.ctaWhatsApp)
      })]
    })]
  })
}
const $e = [{
    id: "karam",
    num: "01",
    icon: "Bot",
    tone: "gold",
    demo: "karam",
    flagship: !0,
    name: {
      en: "Karam Bot",
      ar: "كرم بوت"
    },
    short: {
      en: "WhatsApp AI agents",
      ar: "وكلاء ذكاء اصطناعي على واتساب"
    },
    tagline: {
      en: "AI agents that answer, sell, book and follow up on WhatsApp — 24/7.",
      ar: "وكلاء ذكاء اصطناعي يردّون ويبيعون ويحجزون ويتابعون على واتساب على مدار الساعة."
    },
    features: [{
      en: "Replies in seconds from your menu, prices and hours",
      ar: "يردّ خلال ثوانٍ من قائمتك وأسعارك وأوقاتك"
    }, {
      en: "Takes orders and books appointments into your calendar",
      ar: "يستقبل الطلبات ويحجز المواعيد في تقويمك"
    }, {
      en: "Qualifies leads and follows up automatically",
      ar: "يقيس جدية العملاء ويتابعهم تلقائيًا"
    }, {
      en: "Hands off to a human with full context",
      ar: "يحوّل لموظف مع السياق كاملًا"
    }, {
      en: "Daily report to the owner on WhatsApp",
      ar: "تقرير يومي للمالك على واتساب"
    }],
    best: ["restaurant", "clinic", "salon", "realestate"],
    works: ["loyalty", "booking", "marketing"]
  }, {
    id: "loyalty",
    num: "02",
    icon: "Trophy",
    tone: "electric",
    demo: "loyalty",
    name: {
      en: "Loyalty Points",
      ar: "نقاط الولاء"
    },
    short: {
      en: "Points, tiers, rewards",
      ar: "نقاط ومستويات ومكافآت"
    },
    tagline: {
      en: "Points on every purchase, tiers and rewards that bring customers back.",
      ar: "نقاط على كل عملية شراء، ومستويات ومكافآت تعيد العملاء إليك."
    },
    features: [{
      en: "Customers join with their phone number or a QR code",
      ar: "ينضم العميل برقم هاتفه أو برمز QR"
    }, {
      en: "Points per JD, bonus points and birthday points",
      ar: "نقاط لكل دينار، نقاط إضافية، ونقاط عيد الميلاد"
    }, {
      en: "Bronze, Silver and Gold tiers with their own perks",
      ar: "مستويات برونزي وفضي وذهبي بمزايا خاصة"
    }, {
      en: "WhatsApp notification after every visit and reward",
      ar: "إشعار واتساب بعد كل زيارة ومكافأة"
    }, {
      en: "Reports: top customers, redemptions, inactive customers",
      ar: "تقارير: أفضل العملاء، الاستبدالات، العملاء الخاملون"
    }],
    best: ["restaurant", "salon", "playground", "general"],
    works: ["karam", "marketing", "erp"]
  }, {
    id: "attend",
    num: "03",
    icon: "Clock",
    tone: "electric",
    demo: "attendance",
    name: {
      en: "Attendance System",
      ar: "نظام الدوام"
    },
    short: {
      en: "Check-ins, shifts, payroll",
      ar: "حضور وورديات ورواتب"
    },
    tagline: {
      en: "Check-ins, shifts, lateness alerts and payroll-ready reports for your staff.",
      ar: "تسجيل حضور، ورديات، تنبيهات تأخير، وتقارير جاهزة لكشف الرواتب."
    },
    features: [{
      en: "Fingerprint, QR or mobile check-in with location",
      ar: "تسجيل بالبصمة أو QR أو الجوال مع الموقع"
    }, {
      en: "Shift schedules with grace periods per branch",
      ar: "جداول ورديات مع فترة سماح لكل فرع"
    }, {
      en: "Late and absence alerts to the manager on WhatsApp",
      ar: "تنبيهات التأخير والغياب للمدير على واتساب"
    }, {
      en: "Leave requests, overtime and deductions",
      ar: "طلبات الإجازة والعمل الإضافي والخصومات"
    }, {
      en: "Monthly export ready for payroll (Excel)",
      ar: "تصدير شهري جاهز للرواتب (Excel)"
    }],
    best: ["restaurant", "clinic", "playground", "general"],
    works: ["erp"]
  }, {
    id: "booking",
    num: "04",
    icon: "CalendarCheck",
    tone: "electric",
    name: {
      en: "Bookings & Appointments",
      ar: "الحجوزات والمواعيد"
    },
    short: {
      en: "Calendar, deposits, reminders",
      ar: "تقويم وعربون وتذكيرات"
    },
    tagline: {
      en: "Online booking with real availability, deposits and automatic reminders.",
      ar: "حجز إلكتروني بالتوفر الفعلي، مع عربون وتذكيرات تلقائية."
    },
    features: [{
      en: "Booking page and WhatsApp booking from the same calendar",
      ar: "صفحة حجز وحجز عبر واتساب من التقويم نفسه"
    }, {
      en: "Staff, rooms, tables or packages as resources",
      ar: "الموظفون أو الغرف أو الطاولات أو الباقات كموارد"
    }, {
      en: "Deposits and online payment to cut no-shows",
      ar: "عربون ودفع إلكتروني لتقليل الغياب"
    }, {
      en: "Reminders 24h and 2h before, with reschedule links",
      ar: "تذكير قبل 24 ساعة وقبل ساعتين مع رابط لتعديل الموعد"
    }, {
      en: "Waitlist that fills cancellations automatically",
      ar: "قائمة انتظار تملأ الإلغاءات تلقائيًا"
    }],
    best: ["clinic", "salon", "playground", "realestate"],
    works: ["karam", "marketing"]
  }, {
    id: "subs",
    num: "05",
    icon: "Repeat",
    tone: "electric",
    name: {
      en: "Subscriptions & Packages",
      ar: "الاشتراكات والباقات"
    },
    short: {
      en: "Recurring revenue",
      ar: "إيراد متكرّر"
    },
    tagline: {
      en: "Sell monthly plans and session packages, and never miss a renewal.",
      ar: "بِع الخطط الشهرية وباقات الجلسات، ولا تفوّت أي تجديد."
    },
    features: [{
      en: "Plans, session bundles and family memberships",
      ar: "خطط، باقات جلسات، وعضويات عائلية"
    }, {
      en: "Session counter that deducts on every visit",
      ar: "عدّاد جلسات يُخصم مع كل زيارة"
    }, {
      en: "Renewal reminders on WhatsApp before expiry",
      ar: "تذكير بالتجديد على واتساب قبل الانتهاء"
    }, {
      en: "Freeze, upgrade and transfer rules",
      ar: "قواعد التجميد والترقية والتحويل"
    }, {
      en: "Revenue and churn reports per plan",
      ar: "تقارير الإيراد والانسحاب لكل خطة"
    }],
    best: ["playground", "salon", "clinic", "general"],
    works: ["karam", "booking", "erp"]
  }, {
    id: "marketing",
    num: "06",
    icon: "Zap",
    tone: "electric",
    name: {
      en: "Marketing Automation",
      ar: "التسويق الآلي"
    },
    short: {
      en: "Campaigns, offers, birthdays",
      ar: "حملات وعروض وأعياد ميلاد"
    },
    tagline: {
      en: "WhatsApp campaigns, coupons and birthday offers that send themselves.",
      ar: "حملات واتساب وكوبونات وعروض أعياد ميلاد تُرسل من تلقاء نفسها."
    },
    features: [{
      en: "Segments: new, loyal, inactive, big spenders",
      ar: "شرائح: جدد، أوفياء، خاملون، كبار المنفقين"
    }, {
      en: "Coupons with expiry, limits and tracking",
      ar: "كوبونات بتاريخ انتهاء وحدود وتتبّع"
    }, {
      en: "Automatic birthday and anniversary messages",
      ar: "رسائل تلقائية لأعياد الميلاد والمناسبات"
    }, {
      en: "Win-back flows for customers who stopped coming",
      ar: "مسارات استعادة للعملاء الذين توقفوا عن الزيارة"
    }, {
      en: "Poster studio for offers in your brand colors",
      ar: "استوديو بوسترات للعروض بألوان علامتك"
    }],
    best: ["restaurant", "playground", "salon", "general"],
    works: ["loyalty", "karam"]
  }, {
    id: "erp",
    num: "07",
    icon: "BarChart3",
    tone: "electric",
    name: {
      en: "Business ERP",
      ar: "نظام إدارة الأعمال"
    },
    short: {
      en: "POS, store, finance",
      ar: "نقطة بيع ومتجر ومالية"
    },
    tagline: {
      en: "Point of sale, online store, inventory and finance reports in one place.",
      ar: "نقطة بيع، متجر إلكتروني، مخزون، وتقارير مالية في مكان واحد."
    },
    features: [{
      en: "POS for the counter and an online store for delivery",
      ar: "نقطة بيع للكاشير ومتجر إلكتروني للتوصيل"
    }, {
      en: "Inventory with low-stock alerts",
      ar: "مخزون مع تنبيهات انخفاض الكمية"
    }, {
      en: "Invoices, expenses and daily closing",
      ar: "فواتير ومصاريف وإقفال يومي"
    }, {
      en: "Profit, sales and staff reports",
      ar: "تقارير الأرباح والمبيعات والموظفين"
    }, {
      en: "Multi-branch with one dashboard",
      ar: "فروع متعددة بلوحة تحكم واحدة"
    }],
    best: ["restaurant", "general", "playground"],
    works: ["loyalty", "attend", "subs"]
  }, {
    id: "custom",
    num: "08",
    icon: "Workflow",
    tone: "electric",
    name: {
      en: "Custom Automation",
      ar: "أتمتة مخصّصة"
    },
    short: {
      en: "Integrations & workflows",
      ar: "تكاملات ومسارات عمل"
    },
    tagline: {
      en: "We connect your POS, sheets and apps and build the workflows your team repeats by hand.",
      ar: "نربط نقطة البيع وجداولك وتطبيقاتك، ونبني المسارات التي يكرّرها فريقك يدويًا."
    },
    features: [{
      en: "WhatsApp Cloud API, Google Sheets, calendars, CRMs",
      ar: "واتساب Cloud API، جداول جوجل، التقويمات، أنظمة CRM"
    }, {
      en: "POS integrations and on-premises bridges",
      ar: "تكامل مع أنظمة نقاط البيع وربط محلي"
    }, {
      en: "Make, Zapier and n8n workflows built for you",
      ar: "مسارات Make وZapier وn8n مبنيّة لأجلك"
    }, {
      en: "Dashboards and alerts for the numbers you watch",
      ar: "لوحات وتنبيهات للأرقام التي تتابعها"
    }, {
      en: "Free automation audit before any build",
      ar: "تدقيق أتمتة مجاني قبل أي بناء"
    }],
    best: ["general", "restaurant", "clinic", "realestate"],
    works: ["karam", "erp"]
  }],
  _t = e => $e.find(t => t.id === e),
  R = {
    nav: {
      products: {
        en: "Products",
        ar: "المنتجات"
      },
      karam: {
        en: "Karam Bot",
        ar: "كرم بوت"
      },
      loyalty: {
        en: "Loyalty",
        ar: "الولاء"
      },
      attend: {
        en: "Attendance",
        ar: "الدوام"
      },
      roi: {
        en: "ROI",
        ar: "العائد"
      },
      contact: {
        en: "Contact",
        ar: "تواصل"
      }
    },
    heroEyebrow: {
      en: "SHIFT AI & Automation · Irbid, Jordan",
      ar: "شِفت للذكاء الاصطناعي والأتمتة · إربد، الأردن"
    },
    heroTitle: {
      en: "One company. Every system your business runs on.",
      ar: "شركة واحدة، وكل الأنظمة التي يحتاجها عملك."
    },
    heroSub: {
      en: "Karam Bot answers your WhatsApp. Loyalty brings customers back. Attendance runs your staff. Bookings, subscriptions, marketing and ERP complete the picture — built and run from Irbid for restaurants, clinics, salons, kids centers and stores.",
      ar: "كرم بوت يردّ على واتساب بدلًا منك. نقاط الولاء تُرجِع عملاءك. نظام الدوام يضبط موظفيك. والحجوزات والاشتراكات والتسويق ونظام الإدارة تُكمل الصورة. أنظمة نبنيها ونشغّلها من إربد، للمطاعم والعيادات والصالونات ومراكز الأطفال والمتاجر."
    },
    ctaProducts: {
      en: "Explore the products",
      ar: "شوف المنتجات"
    },
    ctaTalk: {
      en: "Talk to SHIFT on WhatsApp",
      ar: "راسلنا على واتساب"
    },
    heroFeedTitle: {
      en: "Live across one business",
      ar: "يوم عادي في منشأة واحدة"
    },
    heroFeedSub: {
      en: "What the owner sees on a normal morning",
      ar: "ما يصل صاحب العمل بين الساعة 9 و10 صباحًا"
    },
    chips: {
      en: "Products",
      ar: "المنتجات"
    },
    productsEyebrow: {
      en: "SHIFT products",
      ar: "منتجات شِفت"
    },
    productsTitle: {
      en: "Pick the systems you need. They work alone or together.",
      ar: "اختر ما يحتاجه عملك. كل نظام يعمل وحده، ومعًا يعملون أفضل."
    },
    productsNote: {
      en: "Tap a product to see what it does. Add the ones you want to your stack and we will quote it as one plan.",
      ar: "اضغط على أي منتج لترى ماذا يفعل، وأضف ما يناسبك إلى باقتك، ليصلك عرض سعر واحد لكل ما اخترته."
    },
    flagship: {
      en: "Flagship",
      ar: "المنتج الرئيسي"
    },
    addStack: {
      en: "Add to my stack",
      ar: "أضِفه لباقتي"
    },
    inStack: {
      en: "In my stack",
      ar: "في باقتي"
    },
    stackTray: {
      en: "products in your SHIFT stack",
      ar: "منتجات في باقتك من شِفت"
    },
    stackCta: {
      en: "Quote my stack",
      ar: "أرسل لي عرض الباقة"
    },
    stackEmpty: {
      en: "Add at least one product to get a quote.",
      ar: "أضف منتجًا واحدًا على الأقل ليصلك عرض السعر."
    },
    bundleHint: {
      en: "Three or more products qualify for bundle pricing.",
      ar: "من ثلاثة منتجات فأكثر، السعر سعر باقة."
    },
    whatItDoes: {
      en: "What it does",
      ar: "ماذا يفعل"
    },
    bestFor: {
      en: "Best for",
      ar: "الأنسب لـ"
    },
    worksWith: {
      en: "Works with",
      ar: "يعمل مع"
    },
    seeDemo: {
      en: "See it in action",
      ar: "جرّبه الآن"
    },
    askAbout: {
      en: "Ask about",
      ar: "اسأل عن"
    },
    productLabel: {
      en: "Product",
      ar: "المنتج"
    },
    chapterKaram: {
      en: "Karam Bot is the first SHIFT product, and the one every other product talks through.",
      ar: "كرم بوت أول منتجات شِفت، ومنه تتحدث بقية الأنظمة مع عملائك على واتساب."
    },
    loyEyebrow: {
      en: "Loyalty Points · product 02",
      ar: "نقاط الولاء · المنتج 02"
    },
    loyTitle: {
      en: "Give every visit a reason to come back.",
      ar: "خلّي كل زيارة سببًا لزيارة ثانية."
    },
    loySub: {
      en: 'Set the rules, then tap "New visit" to see what the customer receives on WhatsApp.',
      ar: 'اضبط القواعد كما تريدها، ثم اضغط "زيارة جديدة" وشاهد ما يصل عميلك على واتساب.'
    },
    loy: {
      rate: {
        en: "Points per JD spent",
        ar: "نقاط لكل دينار"
      },
      threshold: {
        en: "Reward at",
        ar: "المكافأة عند"
      },
      ticket: {
        en: "Average bill (JD)",
        ar: "متوسط الفاتورة (دينار)"
      },
      visit: {
        en: "New visit",
        ar: "زيارة جديدة"
      },
      redeem: {
        en: "Redeem reward",
        ar: "استبدل المكافأة"
      },
      reset: {
        en: "Reset",
        ar: "إعادة"
      },
      balance: {
        en: "Points balance",
        ar: "رصيد النقاط"
      },
      toReward: {
        en: "to your reward",
        ar: "حتى المكافأة"
      },
      visits: {
        en: "Visits",
        ar: "الزيارات"
      },
      issued: {
        en: "Points issued",
        ar: "نقاط صادرة"
      },
      redeemed: {
        en: "Rewards redeemed",
        ar: "مكافآت مستبدلة"
      },
      tier: {
        en: "Tier",
        ar: "المستوى"
      },
      tiers: {
        bronze: {
          en: "Bronze",
          ar: "برونزي"
        },
        silver: {
          en: "Silver",
          ar: "فضي"
        },
        gold: {
          en: "Gold",
          ar: "ذهبي"
        }
      },
      member: {
        en: "Member card",
        ar: "بطاقة العضوية"
      },
      unlocked: {
        en: "Reward unlocked",
        ar: "المكافأة جاهزة"
      },
      note: {
        en: "Points, tiers and rewards are configured per business. Notifications go out on WhatsApp through Karam Bot or the loyalty number.",
        ar: "تُضبط النقاط والمستويات والمكافآت لكل منشأة. تُرسل الإشعارات على واتساب عبر كرم بوت أو رقم الولاء."
      }
    },
    attEyebrow: {
      en: "Attendance System · product 03",
      ar: "نظام الدوام · المنتج 03"
    },
    attTitle: {
      en: "Know who is in, who is late, and what payroll owes — without a spreadsheet.",
      ar: "اعرف من حضر، ومن تأخّر، وكم يستحق كل موظف، بلا جداول يدوية."
    },
    attSub: {
      en: "Choose the shift rules, then run a morning. Late and absent staff are flagged and the manager is told on WhatsApp.",
      ar: "اختر قواعد الوردية، ثم شغّل صباحًا كاملًا. المتأخر والغائب يُعلَّمان فورًا، والمدير يصله التنبيه على واتساب."
    },
    att: {
      start: {
        en: "Shift starts",
        ar: "بداية الوردية"
      },
      grace: {
        en: "Grace period",
        ar: "فترة السماح"
      },
      staff: {
        en: "Staff on shift",
        ar: "موظفون في الوردية"
      },
      method: {
        en: "Check-in method",
        ar: "طريقة التسجيل"
      },
      methods: {
        finger: {
          en: "Fingerprint",
          ar: "بصمة"
        },
        qr: {
          en: "QR code",
          ar: "رمز QR"
        },
        app: {
          en: "Mobile + location",
          ar: "الجوال مع الموقع"
        }
      },
      run: {
        en: "Run the morning",
        ar: "شغّل الصباح"
      },
      running: {
        en: "Checking in…",
        ar: "جارٍ التسجيل…"
      },
      replay: {
        en: "Run again",
        ar: "شغّل مرة أخرى"
      },
      board: {
        en: "Live attendance board",
        ar: "لوحة الحضور المباشرة"
      },
      waiting: {
        en: "not yet",
        ar: "لم يسجّل"
      },
      ontime: {
        en: "On time",
        ar: "في الوقت"
      },
      late: {
        en: "Late",
        ar: "متأخر"
      },
      absent: {
        en: "Absent",
        ar: "غائب"
      },
      present: {
        en: "Present",
        ar: "حاضر"
      },
      lateBy: {
        en: "late by",
        ar: "تأخر"
      },
      min: {
        en: "min",
        ar: "دقيقة"
      },
      manager: {
        en: "Manager alerts",
        ar: "تنبيهات المدير"
      },
      noAlerts: {
        en: "No alerts yet. Run the morning to see them arrive.",
        ar: "لا تنبيهات بعد. شغّل الصباح لتراها تصل."
      },
      alertLate: {
        en: "is late by",
        ar: "متأخر"
      },
      alertAbsent: {
        en: "has not checked in. Marked absent.",
        ar: "لم يسجّل حضوره. تم تسجيله غائبًا."
      },
      summary: {
        en: "Today",
        ar: "اليوم"
      },
      month: {
        en: "Month at a glance",
        ar: "ملخص الشهر"
      },
      hours: {
        en: "Hours worked",
        ar: "ساعات العمل"
      },
      whatsapp: {
        en: "WhatsApp",
        ar: "واتساب"
      },
      overtime: {
        en: "Overtime (h)",
        ar: "عمل إضافي (ساعة)"
      },
      incidents: {
        en: "Late incidents",
        ar: "حالات تأخير"
      },
      exportBtn: {
        en: "Export payroll sheet",
        ar: "تصدير كشف الرواتب"
      },
      exported: {
        en: "Payroll sheet ready (Excel) · sent to the manager",
        ar: "كشف الرواتب جاهز (Excel) · أُرسل للمدير"
      },
      note: {
        en: "Demo data. Real installs sync from your fingerprint device, QR or the staff app, with rules per branch.",
        ar: "بيانات تجريبية. في التركيب الفعلي تتم المزامنة من جهاز البصمة أو QR أو تطبيق الموظفين، بقواعد لكل فرع."
      }
    },
    roiEyebrow: {
      en: "Return on automation",
      ar: "قيمة الأتمتة"
    },
    roiTitle: {
      en: "What would SHIFT give back to your month?",
      ar: "كم توفّر عليك شِفت كل شهر؟"
    },
    roiPick: {
      en: "Include in the estimate",
      ar: "احسب لي"
    },
    roi: {
      customers: {
        en: "Customers per month",
        ar: "عملاء شهريًا"
      },
      ticket: {
        en: "Average bill (JD)",
        ar: "متوسط الفاتورة (دينار)"
      },
      staff: {
        en: "Staff on payroll",
        ar: "موظفون على الرواتب"
      },
      revenue: {
        en: "Extra revenue per month",
        ar: "إيراد إضافي شهريًا"
      },
      total: {
        en: "Total monthly value",
        ar: "القيمة الشهرية الإجمالية"
      },
      note: {
        en: "Estimates: Karam handles ~80% of routine messages and recovers 60% of missed leads; loyalty lifts repeat visits by ~12%; attendance saves ~45 minutes of admin per employee per week. Your audit uses your real numbers.",
        ar: "تقديرات: كرم يتولّى نحو 80% من الرسائل الروتينية ويستعيد 60% من العملاء الضائعين؛ الولاء يرفع الزيارات المتكررة نحو 12%؛ الدوام يوفّر نحو 45 دقيقة إدارية لكل موظف أسبوعيًا. التدقيق يستخدم أرقامك الفعلية."
      }
    },
    finalTitle: {
      en: "Ready to run your business on SHIFT?",
      ar: "جاهز تشغّل عملك على شِفت؟"
    },
    finalSub: {
      en: "Start with one product. Add the rest when you are ready — same team, same WhatsApp number.",
      ar: "ابدأ بمنتج واحد وأضف الباقي متى شئت. الفريق نفسه، والرقم نفسه، وبلا تعقيد."
    },
    formProducts: {
      en: "Products I am interested in",
      ar: "المنتجات التي تهمّني"
    },
    footer: {
      en: "SHIFT AI & Automation · Irbid, Jordan",
      ar: "شِفت للذكاء الاصطناعي والأتمتة · إربد، الأردن"
    },
    footerLine: {
      en: "Karam Bot, Loyalty Points, Attendance, Bookings, Subscriptions, Marketing Automation, ERP and custom automation for businesses in Jordan.",
      ar: "كرم بوت، نقاط الولاء، الدوام، الحجوزات، الاشتراكات، التسويق الآلي، نظام الإدارة، والأتمتة المخصّصة للمنشآت في الأردن."
    },
    heroFeed: [{
      p: "karam",
      icon: "Bot",
      en: "Karam replied to a new order · 2 beef burgers · 11.5 JD",
      ar: "كرم ردّ على طلب جديد · برجرين لحم · 11.5 دينار"
    }, {
      p: "loyalty",
      icon: "Trophy",
      en: "Sara earned 45 points · 55 to her free meal",
      ar: "سارة كسبت 45 نقطة · 55 حتى وجبتها المجانية"
    }, {
      p: "attend",
      icon: "Clock",
      en: "Omar checked in 08:57 · on time",
      ar: "عمر سجّل الحضور 08:57 · في الوقت"
    }, {
      p: "booking",
      icon: "CalendarCheck",
      en: "Table for 4 booked · 8:00 pm · deposit paid",
      ar: "حجز طاولة لأربعة · 8:00 مساءً · العربون مدفوع"
    }, {
      p: "attend",
      icon: "AlertTriangle",
      en: "Khaled is 25 min late · manager alerted",
      ar: "خالد متأخر 25 دقيقة · تم تنبيه المدير"
    }, {
      p: "marketing",
      icon: "Zap",
      en: "Birthday offer sent to 12 customers this week",
      ar: "أُرسل عرض عيد الميلاد لـ12 عميلًا هذا الأسبوع"
    }, {
      p: "subs",
      icon: "Repeat",
      en: "Lina renewed her 10-session package",
      ar: "لينا جدّدت باقة العشر جلسات"
    }, {
      p: "erp",
      icon: "BarChart3",
      en: "Daily closing · 1,240 JD · 3 items low in stock",
      ar: "الإقفال اليومي · 1,240 دينار · 3 أصناف على وشك النفاد"
    }]
  },
  Sr = "data:image/png;base64,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",
  yr = "SHIFT AI & Automation",
  Bm = "https://www.facebook.com/profile.php?id=61593849817699";

function Om() {
  const {
    t: e
  } = V(), t = R.nav, n = [
    ["#products", t.products],
    ["#karam", t.karam],
    ["#loyalty", t.loyalty],
    ["#attendance", t.attend],
    ["#roi", t.roi],
    ["#contact", t.contact]
  ];
  return s.jsx("header", {
    className: "kb-nav",
    children: s.jsxs("div", {
      className: "kb-container h-16 flex items-center gap-4",
      children: [s.jsx("a", {
        href: "#top",
        className: "flex items-center gap-3",
        "aria-label": yr,
        children: s.jsx("img", {
          src: Sr,
          alt: yr,
          className: "h-10 w-auto"
        })
      }), s.jsx("nav", {
        className: "hidden md:flex items-center gap-1 ms-4",
        "aria-label": "Sections",
        children: n.map(([r, l]) => s.jsx("a", {
          href: r,
          className: "kb-navlink",
          children: e(l)
        }, r))
      }), s.jsxs("div", {
        className: "ms-auto flex items-center gap-3",
        children: [s.jsx(Fm, {}), s.jsx(W, {
          size: "sm",
          variant: "primary",
          href: "#products",
          className: "hidden sm:inline-flex",
          icon: "Layers",
          children: e(R.nav.products)
        })]
      })]
    })
  })
}

function Wm() {
  const {
    t: e
  } = V();
  return s.jsxs("div", {
    className: "kb-sticky",
    role: "region",
    "aria-label": "Quick actions",
    children: [s.jsxs("a", {
      href: "#products",
      className: "flex-1 h-11 rounded-full bg-[var(--kb-gold)] text-[var(--kb-ink)] font-bold text-sm inline-flex items-center justify-center gap-2",
      children: [s.jsx(I, {
        name: "Layers",
        className: "w-4 h-4"
      }), e(R.ctaProducts)]
    }), s.jsx("a", {
      href: `https://wa.me/${He}`,
      target: "_blank",
      rel: "noopener",
      className: "h-11 w-11 rounded-full bg-[#25D366] text-[#062b1a] inline-flex items-center justify-center",
      "aria-label": e(N.ctaWhatsApp),
      children: s.jsx(I, {
        name: "MessageCircle",
        className: "w-5 h-5"
      })
    })]
  })
}

function Um() {
  const {
    t: e,
    lang: t
  } = V();
  return s.jsx("footer", {
    className: "bg-[var(--kb-ink)] text-[#8FA0BD] text-sm",
    children: s.jsxs("div", {
      className: "kb-container py-10 grid md:grid-cols-[1.2fr_1fr_auto] gap-8 border-t border-white/10",
      children: [s.jsxs("div", {
        children: [s.jsx("img", {
          src: Sr,
          alt: yr,
          className: "h-9 w-auto rounded bg-white/95 p-1"
        }), s.jsx("p", {
          className: "mt-3 text-white font-semibold",
          children: e(R.footer)
        }), s.jsx("p", {
          className: "mt-1 max-w-[52ch] leading-relaxed",
          children: e(R.footerLine)
        })]
      }), s.jsxs("div", {
        children: [s.jsx("p", {
          className: "text-xs font-bold uppercase tracking-wider text-white/70 mb-2",
          children: e(R.nav.products)
        }), s.jsx("ul", {
          className: "grid grid-cols-2 gap-x-4 gap-y-1",
          children: $e.map(n => s.jsx("li", {
            children: s.jsxs("a", {
              href: "#products",
              className: "hover:text-white flex items-center gap-1.5",
              children: [s.jsx(I, {
                name: n.icon,
                className: "w-3.5 h-3.5"
              }), e(n.name)]
            })
          }, n.id))
        })]
      }), s.jsxs("div", {
        className: "grid gap-2 content-start",
        children: [s.jsxs("a", {
          href: `https://wa.me/${He}`,
          target: "_blank",
          rel: "noopener",
          className: "hover:text-white flex items-center gap-2",
          children: [s.jsx(I, {
            name: "MessageCircle",
            className: "w-4 h-4"
          }), s.jsx("span", {
            dir: "ltr",
            className: "tabular-nums",
            children: Vc
          })]
        }), s.jsx("a", {
          href: Bm,
          target: "_blank",
          rel: "noopener",
          className: "hover:text-white",
          children: t === "ar" ? "شِفت على فيسبوك" : "SHIFT on Facebook"
        }), s.jsx("a", {
          href: "/privacy",
          className: "hover:text-white",
          children: "Privacy"
        }), s.jsx("a", {
          href: "/login",
          className: "hover:text-white",
          children: t === "ar" ? "دخول العملاء" : "Client login"
        })]
      })]
    })
  })
}

function Hm() {
  const {
    t: e,
    lang: t
  } = V(), n = R.heroFeed, r = 5, [l, a] = C.useState(3);
  C.useEffect(() => {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      a(n.length);
      return
    }
    const u = setInterval(() => a(c => c >= n.length ? 2 : c + 1), 1700);
    return () => clearInterval(u)
  }, [n.length]);
  const i = n.slice(Math.max(0, l - r), l);
  return s.jsxs("div", {
    className: "kb-ops",
    "aria-label": e(R.heroFeedTitle),
    children: [s.jsxs("div", {
      className: "kb-ops-head",
      children: [s.jsx("img", {
        src: Sr,
        alt: "",
        className: "h-6 w-auto rounded bg-white p-0.5"
      }), s.jsxs("div", {
        className: "leading-tight",
        children: [s.jsx("p", {
          className: "text-sm font-bold text-white",
          children: e(R.heroFeedTitle)
        }), s.jsx("p", {
          className: "text-[11px] text-[#8FA0BD]",
          children: e(R.heroFeedSub)
        })]
      }), s.jsxs("span", {
        className: "kb-live ms-auto",
        children: [s.jsx("i", {}), t === "ar" ? "مباشر" : "LIVE"]
      })]
    }), s.jsx("ul", {
      className: "kb-ops-body",
      children: i.map((o, u) => {
        const c = $e.find(p => p.id === o.p),
          g = o.icon === "AlertTriangle";
        return s.jsxs("li", {
          className: `kb-ops-row ${g?"is-warn":""} ${u===i.length-1?"is-new":""}`,
          children: [s.jsx("span", {
            className: "kb-ops-ic",
            children: s.jsx(I, {
              name: o.icon,
              className: "w-4 h-4"
            })
          }), s.jsxs("div", {
            className: "min-w-0",
            children: [s.jsx("p", {
              className: "text-[10px] font-bold uppercase tracking-wider text-[var(--kb-signal)] truncate",
              children: e(c.name)
            }), s.jsx("p", {
              className: "text-[13.5px] text-white/95 leading-snug",
              children: e(o)
            })]
          })]
        }, `${o.en}-${t}`)
      })
    }), s.jsx("div", {
      className: "kb-ops-foot",
      children: $e.map(o => s.jsx("span", {
        className: "kb-ops-dot",
        title: e(o.name),
        children: s.jsx(I, {
          name: o.icon,
          className: "w-3.5 h-3.5"
        })
      }, o.id))
    })]
  })
}

function Vm({
  setActive: e
}) {
  const {
    t,
    lang: n
  } = V(), r = l => {
    e(l), gr("products")
  };
  return s.jsxs("section", {
    id: "top",
    className: "relative overflow-hidden bg-[var(--kb-ground)] kb-grid-bg",
    children: [s.jsx("div", {
      className: "absolute inset-x-0 top-0 h-[520px] bg-[radial-gradient(60%_50%_at_20%_0%,rgba(31,107,255,.14),transparent),radial-gradient(40%_40%_at_90%_10%,rgba(242,179,61,.18),transparent)]",
      "aria-hidden": "true"
    }), s.jsxs("div", {
      className: "relative kb-container pt-10 pb-16 md:pt-16 md:pb-24 grid lg:grid-cols-[1.1fr_.9fr] gap-12 items-center",
      children: [s.jsxs("div", {
        children: [s.jsxs("p", {
          className: "kb-eyebrow text-[var(--kb-electric)] flex items-center gap-2",
          children: [s.jsx(I, {
            name: "MapPin",
            className: "w-4 h-4"
          }), t(R.heroEyebrow)]
        }), s.jsx("h1", {
          className: "kb-h1",
          children: t(R.heroTitle)
        }), s.jsx("p", {
          className: "kb-lead mt-5",
          children: t(R.heroSub)
        }), s.jsxs("div", {
          className: "mt-7 flex flex-col sm:flex-row gap-3",
          children: [s.jsx(W, {
            variant: "primary",
            size: "lg",
            icon: "Layers",
            onClick: () => gr("products"),
            children: t(R.ctaProducts)
          }), s.jsx(W, {
            variant: "wa",
            size: "lg",
            icon: "MessageCircle",
            href: `https://wa.me/${He}?text=${encodeURIComponent(n==="ar"?"مرحبًا شِفت، أريد معرفة المزيد عن منتجاتكم":"Hi SHIFT, I want to know more about your products")}`,
            target: "_blank",
            rel: "noopener",
            children: t(R.ctaTalk)
          })]
        }), s.jsx("p", {
          className: "mt-8 text-xs font-bold uppercase tracking-wider text-[var(--kb-muted)]",
          children: t(R.chips)
        }), s.jsx("div", {
          className: "mt-3 flex flex-wrap gap-2",
          children: $e.map(l => s.jsxs("button", {
            type: "button",
            onClick: () => r(l.id),
            className: `kb-chip ${l.flagship?"is-gold":""}`,
            children: [s.jsx(I, {
              name: l.icon,
              className: "w-4 h-4"
            }), t(l.name), l.flagship && s.jsx("span", {
              className: "kb-chip-num",
              children: "01"
            })]
          }, l.id))
        })]
      }), s.jsxs("div", {
        className: "relative",
        children: [s.jsx("div", {
          className: "absolute -inset-6 rounded-[40px] bg-[radial-gradient(60%_60%_at_50%_40%,rgba(31,107,255,.18),transparent)]",
          "aria-hidden": "true"
        }), s.jsx("div", {
          className: "relative max-w-[440px] mx-auto",
          children: s.jsx(Hm, {})
        }), s.jsx("img", {
          src: Sr,
          alt: yr,
          className: "sr-only"
        })]
      })]
    })]
  })
}

function $m(e, t, n) {
  const l = $e.filter(a => e[a.id]).map(a => n(a.name)).join(t === "ar" ? "، " : ", ");
  return t === "ar" ? `مرحبًا شِفت، أريد عرض سعر لباقة من: ${l}` : `Hi SHIFT, I'd like a quote for a stack of: ${l}`
}

function ws({
  id: e,
  stack: t,
  setStack: n,
  size: r = "sm",
  dark: l = !1,
  className: a = ""
}) {
  const {
    t: i
  } = V(), o = !!t[e], u = l ? o ? "bg-[var(--kb-gold)] text-[var(--kb-ink)] border-[var(--kb-gold)]" : "bg-white/10 text-white border-white/25 hover:bg-white/15" : o ? "bg-[var(--kb-ink)] text-white border-[var(--kb-ink)]" : "bg-white text-[var(--kb-ink)] border-[var(--kb-line)] hover:border-[var(--kb-ink)]";
  return s.jsxs("button", {
    type: "button",
    "aria-pressed": o,
    onClick: c => {
      c.stopPropagation(), n(g => ({
        ...g,
        [e]: !g[e]
      }))
    },
    className: `kb-btn inline-flex items-center justify-center gap-1.5 rounded-full font-semibold border transition-all ${r==="sm"?"h-9 px-3 text-xs":"h-11 px-5 text-sm"} ${u} ${a}`,
    children: [s.jsx(I, {
      name: o ? "Check" : "Plus",
      className: "w-3.5 h-3.5"
    }), i(o ? R.inStack : R.addStack)]
  })
}

function Km({
  stack: e
}) {
  const {
    t,
    lang: n
  } = V(), r = $e.filter(i => e[i.id]), l = r.length, a = `https://wa.me/${He}?text=${encodeURIComponent($m(e,n,t))}`;
  return s.jsxs("div", {
    className: "flex flex-wrap items-center gap-3 rounded-2xl bg-[var(--kb-gold-soft)] border border-[#F3DDAA] px-4 py-3",
    children: [s.jsxs("div", {
      className: "flex -space-x-2 rtl:space-x-reverse",
      children: [r.slice(0, 5).map(i => s.jsx("span", {
        className: "w-8 h-8 rounded-full bg-[var(--kb-gold)] border-2 border-white grid place-items-center text-[var(--kb-ink)]",
        children: s.jsx(I, {
          name: i.icon,
          className: "w-4 h-4"
        })
      }, i.id)), l === 0 && s.jsx("span", {
        className: "w-8 h-8 rounded-full bg-white border-2 border-[#F3DDAA] grid place-items-center text-[#9A5F00]",
        children: s.jsx(I, {
          name: "Plus",
          className: "w-4 h-4"
        })
      })]
    }), s.jsx("p", {
      className: "text-sm font-bold",
      children: n === "ar" ? l === 1 ? "منتج واحد في باقتك من شِفت" : l === 2 ? "منتجان في باقتك من شِفت" : s.jsxs(s.Fragment, {
        children: [s.jsx("span", {
          className: "tabular-nums",
          children: l
        }), " ", t(R.stackTray)]
      }) : s.jsxs(s.Fragment, {
        children: [s.jsx("span", {
          className: "tabular-nums",
          children: l
        }), " ", l === 1 ? "product in your SHIFT stack" : t(R.stackTray)]
      })
    }), l > 0 ? s.jsx(W, {
      size: "sm",
      variant: "primary",
      href: a,
      target: "_blank",
      rel: "noopener",
      icon: "ArrowUpRight",
      children: t(R.stackCta)
    }) : s.jsx("span", {
      className: "text-xs text-[#9A5F00]",
      children: t(R.stackEmpty)
    }), l >= 3 && s.jsxs("span", {
      className: "w-full sm:w-auto text-xs font-semibold text-[#9A5F00] flex items-center gap-1",
      children: [s.jsx(I, {
        name: "Percent",
        className: "w-3.5 h-3.5"
      }), t(R.bundleHint)]
    })]
  })
}
const Ym = {
  karam: "karam",
  loyalty: "loyalty",
  attendance: "attendance"
};

function qm({
  active: e,
  setActive: t,
  stack: n,
  setStack: r
}) {
  const {
    t: l,
    lang: a
  } = V(), i = _t(e) || $e[0], o = `https://wa.me/${He}?text=${encodeURIComponent(a==="ar"?`مرحبًا شِفت، أريد معرفة المزيد عن ${l(i.name)}`:`Hi SHIFT, I want to know more about ${l(i.name)}`)}`;
  return s.jsxs(ze, {
    id: "products",
    tone: "white",
    children: [s.jsxs("div", {
      className: "flex flex-col lg:flex-row lg:items-end gap-6 justify-between",
      children: [s.jsxs("div", {
        children: [s.jsx(Ke, {
          children: l(R.productsEyebrow)
        }), s.jsx(Ye, {
          children: l(R.productsTitle)
        }), s.jsx("p", {
          className: "kb-lead mt-4 text-base",
          children: l(R.productsNote)
        })]
      }), s.jsx(Km, {
        stack: n
      })]
    }), s.jsx("div", {
      className: "mt-10 grid sm:grid-cols-2 lg:grid-cols-4 gap-4",
      role: "tablist",
      "aria-label": l(R.productsEyebrow),
      children: $e.map(u => {
        const c = u.id === i.id;
        return s.jsxs("div", {
          role: "tab",
          tabIndex: 0,
          "aria-selected": c,
          onClick: () => t(u.id),
          onKeyDown: g => {
            (g.key === "Enter" || g.key === " ") && (g.preventDefault(), t(u.id))
          },
          className: `kb-product ${c?"is-active":""} ${u.flagship?"is-flagship":""}`,
          children: [s.jsxs("div", {
            className: "flex items-start justify-between gap-2",
            children: [s.jsx("span", {
              className: "kb-product-ic",
              children: s.jsx(I, {
                name: u.icon,
                className: "w-5 h-5"
              })
            }), s.jsx("span", {
              className: "kb-product-num",
              children: u.num
            })]
          }), s.jsx("h3", {
            className: "kb-display text-lg font-extrabold leading-tight mt-4",
            children: l(u.name)
          }), s.jsx("p", {
            className: "text-sm text-[var(--kb-muted)] mt-1",
            children: l(u.short)
          }), u.flagship && s.jsx("span", {
            className: "kb-flag",
            children: l(R.flagship)
          }), s.jsxs("div", {
            className: "mt-4 flex items-center justify-between gap-2",
            children: [s.jsx(ws, {
              id: u.id,
              stack: n,
              setStack: r
            }), u.demo && s.jsxs("span", {
              className: "text-[11px] font-bold text-[var(--kb-electric)] flex items-center gap-1",
              children: [s.jsx(I, {
                name: "Play",
                className: "w-3 h-3"
              }), a === "ar" ? "تجربة" : "demo"]
            })]
          })]
        }, u.id)
      })
    }), s.jsxs("div", {
      className: "mt-6 rounded-3xl border border-[var(--kb-line)] bg-[var(--kb-ground)] p-6 md:p-8 kb-card-enter grid lg:grid-cols-[1.2fr_.8fr] gap-8",
      role: "tabpanel",
      children: [s.jsxs("div", {
        children: [s.jsxs("p", {
          className: "text-xs font-bold uppercase tracking-wider text-[var(--kb-muted)]",
          children: [l(R.productLabel), " ", i.num]
        }), s.jsxs("div", {
          className: "flex items-center gap-3 mt-2",
          children: [s.jsx("span", {
            className: `w-12 h-12 rounded-2xl grid place-items-center ${i.flagship?"bg-[var(--kb-gold)] text-[var(--kb-ink)]":"bg-[var(--kb-electric)] text-white"}`,
            children: s.jsx(I, {
              name: i.icon,
              className: "w-6 h-6"
            })
          }), s.jsx("h3", {
            className: "kb-display text-2xl md:text-3xl font-extrabold leading-tight",
            children: l(i.name)
          })]
        }), s.jsx("p", {
          className: "kb-lead mt-4 text-[17px]",
          children: l(i.tagline)
        }), s.jsx("p", {
          className: "text-xs font-bold uppercase tracking-wider text-[var(--kb-muted)] mt-6 mb-2",
          children: l(R.whatItDoes)
        }), s.jsx("ul", {
          className: "grid sm:grid-cols-2 gap-x-6 gap-y-2",
          children: i.features.map((u, c) => s.jsxs("li", {
            className: "flex gap-2 text-[15px] text-[var(--kb-ink-2)]",
            children: [s.jsx(I, {
              name: "CheckCircle2",
              className: "w-4 h-4 mt-1 text-[var(--kb-ok)] shrink-0"
            }), s.jsx("span", {
              children: l(u)
            })]
          }, c))
        })]
      }), s.jsxs("div", {
        className: "grid gap-4 content-start",
        children: [s.jsxs("div", {
          className: "rounded-2xl bg-white border border-[var(--kb-line)] p-5",
          children: [s.jsx("p", {
            className: "text-xs font-bold uppercase tracking-wider text-[var(--kb-muted)] mb-2",
            children: l(R.bestFor)
          }), s.jsx("div", {
            className: "flex flex-wrap gap-2",
            children: i.best.map(u => {
              const c = Ce.find(g => g.id === u);
              return c ? s.jsxs("span", {
                className: "inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-full bg-[var(--kb-gold-soft)] text-[#7A4B00]",
                children: [s.jsx(I, {
                  name: c.icon,
                  className: "w-3.5 h-3.5"
                }), l(c.label)]
              }, u) : null
            })
          }), s.jsx("p", {
            className: "text-xs font-bold uppercase tracking-wider text-[var(--kb-muted)] mt-4 mb-2",
            children: l(R.worksWith)
          }), s.jsx("div", {
            className: "flex flex-wrap gap-2",
            children: i.works.map(u => {
              const c = _t(u);
              return c ? s.jsxs("button", {
                type: "button",
                onClick: () => t(u),
                className: "inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-full bg-[var(--kb-electric-soft)] text-[var(--kb-electric)] hover:bg-[#d9e6ff]",
                children: [s.jsx(I, {
                  name: c.icon,
                  className: "w-3.5 h-3.5"
                }), l(c.name)]
              }, u) : null
            })
          })]
        }), s.jsxs("div", {
          className: "flex flex-col gap-3",
          children: [i.demo && s.jsx(W, {
            variant: "primary",
            icon: "Play",
            onClick: () => gr(Ym[i.demo]),
            children: l(R.seeDemo)
          }), s.jsxs(W, {
            variant: "wa",
            icon: "MessageCircle",
            href: o,
            target: "_blank",
            rel: "noopener",
            children: [l(R.askAbout), " ", l(i.name)]
          }), s.jsx(ws, {
            id: i.id,
            stack: n,
            setStack: r,
            size: "md"
          })]
        })]
      })]
    }, i.id)]
  })
}

function ka({
  id: e,
  anchor: t,
  stack: n,
  setStack: r,
  note: l
}) {
  const {
    t: a
  } = V(), i = _t(e);
  return s.jsx("div", {
    id: t,
    className: "kb-chapter",
    children: s.jsxs("div", {
      className: "kb-container flex flex-col md:flex-row md:items-center gap-5 justify-between",
      children: [s.jsxs("div", {
        className: "flex items-center gap-4",
        children: [s.jsx("span", {
          className: "kb-chapter-num",
          children: i.num
        }), s.jsxs("div", {
          children: [s.jsxs("p", {
            className: "text-xs font-bold uppercase tracking-wider text-[var(--kb-signal)]",
            children: [a(R.productLabel), " ", i.num, " · SHIFT"]
          }), s.jsxs("h2", {
            className: "kb-display text-2xl md:text-3xl font-extrabold text-white leading-tight flex items-center gap-3",
            children: [e === "karam" ? s.jsx(Nr, {
              size: 32
            }) : s.jsx("span", {
              className: "w-9 h-9 rounded-xl bg-white/10 grid place-items-center",
              children: s.jsx(I, {
                name: i.icon,
                className: "w-5 h-5"
              })
            }), a(i.name)]
          }), s.jsx("p", {
            className: "text-sm text-[#B8C4DA] mt-1 max-w-[60ch]",
            children: a(l || i.tagline)
          })]
        })]
      }), s.jsx(ws, {
        id: e,
        stack: n,
        setStack: r,
        size: "md",
        dark: !0,
        className: "self-start md:self-auto"
      })]
    })
  })
}

function Gt({
  options: e,
  value: t,
  onChange: n,
  electric: r = !1,
  label: l
}) {
  const {
    t: a
  } = V(), i = Math.max(0, e.findIndex(c => c.id === t)), o = e[i] || e[0], u = () => n(e[(i + 1) % e.length].id);
  return s.jsx("button", {
    type: "button",
    className: `kb-word ${r?"is-electric":""}`,
    onClick: u,
    "aria-label": `${l}: ${a(o.label)}`,
    children: a(o.label)
  })
}

function Qm() {
  const {
    t: e,
    lang: t
  } = V(), n = N.heroFeed, [r, l] = C.useState(2), [a, i] = C.useState(!1);
  C.useEffect(() => {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      l(n.length);
      return
    }
    let c = !0;
    const g = () => {
        c && l(h => h >= n.length ? (i(!1), 1) : h + 1)
      },
      p = setInterval(() => {
        i(!0), setTimeout(g, 700)
      }, 1900);
    return () => {
      c = !1, clearInterval(p)
    }
  }, [n.length]);
  const o = n.slice(0, r);
  return s.jsx("div", {
    className: "kb-device",
    "aria-label": t === "ar" ? "معاينة حيّة للوكيل" : "Live agent preview",
    children: s.jsxs("div", {
      className: "kb-screen",
      children: [s.jsxs("div", {
        className: "kb-chat-head",
        children: [s.jsx(Nr, {
          size: 34
        }), s.jsxs("div", {
          className: "leading-tight",
          children: [s.jsx("p", {
            className: "text-sm font-bold text-[#111B21]",
            children: e(N.demoAgent)
          }), s.jsx("p", {
            className: "text-[11px] text-[#54656F]",
            children: e(a ? N.typing : N.online)
          })]
        }), s.jsxs("span", {
          className: "kb-live ms-auto",
          children: [s.jsx("i", {}), t === "ar" ? "مباشر" : "LIVE"]
        })]
      }), s.jsxs("div", {
        className: "kb-chat-body",
        children: [o.map((u, c) => s.jsxs("div", {
          className: `kb-bubble ${u.kind==="in"?"in":u.kind==="out"?"out":u.kind}`,
          children: [u.kind === "book" && s.jsx(I, {
            name: "CalendarCheck",
            className: "w-4 h-4 inline me-1.5 -mt-0.5"
          }), u.kind === "owner" && s.jsx(I, {
            name: "BellRing",
            className: "w-4 h-4 inline me-1.5 -mt-0.5"
          }), u.kind === "report" && s.jsx(I, {
            name: "BarChart3",
            className: "w-4 h-4 inline me-1.5 -mt-0.5"
          }), e(u)]
        }, `${c}-${t}`)), a && r < n.length && s.jsx("div", {
          className: "kb-bubble in",
          children: s.jsxs("span", {
            className: "kb-typing",
            children: [s.jsx("i", {}), s.jsx("i", {}), s.jsx("i", {})]
          })
        })]
      })]
    })
  })
}

function Gm({
  selection: e,
  setSelection: t
}) {
  const {
    t: n,
    lang: r
  } = V(), l = i => o => t(u => ({
    ...u,
    [i]: o
  })), a = r === "ar" ? s.jsxs(s.Fragment, {
    children: [n(N.meet), " ", s.jsx("span", {
      className: "kb-word",
      style: {
        cursor: "default"
      },
      children: "كرم"
    }), "، ", s.jsx(Gt, {
      label: "الدور",
      options: mr,
      value: e.role,
      onChange: l("role")
    }), " ", "لـ", s.jsx(Gt, {
      label: "النشاط",
      options: Ce,
      value: e.business,
      onChange: l("business")
    }), " ", "عبر ", s.jsx(Gt, {
      label: "القناة",
      options: hr,
      value: e.channel,
      onChange: l("channel"),
      electric: !0
    }), "."]
  }) : s.jsxs(s.Fragment, {
    children: [n(N.meet), " ", s.jsx("span", {
      className: "kb-word",
      style: {
        cursor: "default"
      },
      children: "Karam"
    }), ", your", " ", s.jsx(Gt, {
      label: "Role",
      options: mr,
      value: e.role,
      onChange: l("role")
    }), " for", " ", s.jsx(Gt, {
      label: "Business",
      options: Ce,
      value: e.business,
      onChange: l("business")
    }), " on", " ", s.jsx(Gt, {
      label: "Channel",
      options: hr,
      value: e.channel,
      onChange: l("channel"),
      electric: !0
    }), "."]
  });
  return s.jsx("section", {
    id: "karam-hero",
    className: "relative overflow-hidden bg-[var(--kb-ground)] kb-grid-bg",
    children: s.jsxs("div", {
      className: "kb-container pt-12 pb-16 md:pt-20 md:pb-24 grid lg:grid-cols-[1.15fr_.85fr] gap-12 items-center",
      children: [s.jsxs("div", {
        children: [s.jsx("p", {
          className: "kb-eyebrow text-[var(--kb-electric)]",
          children: n(N.heroEyebrow)
        }), s.jsx("h2", {
          className: "kb-h1 kb-h1-chapter",
          children: n(N.heroTitle)
        }), s.jsx("p", {
          className: "kb-lead mt-5",
          children: n(N.heroSub)
        }), s.jsxs("div", {
          className: "mt-8 p-5 md:p-6 rounded-3xl bg-white border border-[var(--kb-line)] shadow-[0_20px_50px_-30px_rgba(15,30,56,.35)]",
          children: [s.jsx("p", {
            className: "kb-display text-[22px] md:text-[28px] font-bold leading-[1.5]",
            children: a
          }), s.jsxs("p", {
            className: "text-xs text-[var(--kb-muted)] mt-3 flex items-center gap-1.5",
            children: [s.jsx(I, {
              name: "MousePointerClick",
              className: "w-3.5 h-3.5"
            }), n(N.madlibHint)]
          })]
        }), s.jsxs("div", {
          className: "mt-7 flex flex-col sm:flex-row gap-3",
          children: [s.jsx(W, {
            variant: "primary",
            size: "lg",
            icon: "Wand2",
            onClick: () => gr("builder"),
            children: n(N.ctaBuild)
          }), s.jsx(W, {
            variant: "ghost",
            size: "lg",
            icon: "Play",
            onClick: () => gr("rescue"),
            children: n(N.ctaWatch)
          })]
        }), s.jsx("p", {
          className: "mt-6 text-sm text-[var(--kb-muted)]",
          children: n(N.taglines[0])
        })]
      }), s.jsxs("div", {
        className: "relative",
        children: [s.jsx("div", {
          className: "absolute -inset-6 rounded-[40px] bg-[radial-gradient(60%_60%_at_50%_40%,rgba(31,107,255,.18),transparent)]",
          "aria-hidden": "true"
        }), s.jsx("div", {
          className: "relative max-w-[420px] mx-auto",
          children: s.jsx(Qm, {})
        })]
      })]
    })
  })
}
const wa = [{
  key: "business",
  options: Ce
}, {
  key: "role",
  options: mr
}, {
  key: "channel",
  options: hr
}, {
  key: "pain",
  options: xs
}];

function Zm({
  selection: e,
  setSelection: t
}) {
  const {
    t: n,
    lang: r
  } = V(), [l, a] = C.useState(0), [i, o] = C.useState(!1), u = wa[l], c = v => t(k => ({
    ...k,
    [u.key]: v
  })), g = () => {
    l < 3 ? a(l + 1) : (o(!0), a(4))
  }, p = () => a(Math.max(0, l - 1)), h = () => {
    o(!1), a(0)
  };
  return s.jsxs(ze, {
    id: "builder",
    tone: "white",
    children: [s.jsxs("div", {
      className: "max-w-3xl",
      children: [s.jsx(Ke, {
        children: n(N.builderEyebrow)
      }), s.jsx(Ye, {
        children: n(N.builderTitle)
      })]
    }), s.jsxs("div", {
      className: "mt-10 grid lg:grid-cols-[1fr_1.05fr] gap-8 items-start",
      children: [s.jsxs("div", {
        className: "rounded-3xl border border-[var(--kb-line)] bg-[var(--kb-ground)] p-5 md:p-7",
        children: [s.jsx("div", {
          className: "kb-steps mb-3",
          "aria-hidden": "true",
          children: N.steps.map((v, k) => s.jsx("div", {
            className: `kb-step ${k<l?"is-done":k===l?"is-now":""}`
          }, k))
        }), s.jsxs("div", {
          className: "flex items-center justify-between mb-5",
          children: [s.jsx("p", {
            className: "text-sm font-bold text-[var(--kb-muted)]",
            children: r === "ar" ? `الخطوة ${Math.min(l+1,5)} من 5` : `Step ${Math.min(l+1,5)} of 5`
          }), s.jsx("p", {
            className: "kb-display text-lg font-extrabold",
            children: n(N.steps[Math.min(l, 4)])
          })]
        }), l < 4 ? s.jsx("div", {
          role: "radiogroup",
          "aria-label": n(N.steps[l]),
          className: "grid sm:grid-cols-2 gap-3",
          children: u.options.map(v => s.jsx(Sn, {
            icon: v.icon,
            selected: e[u.key] === v.id,
            onClick: () => c(v.id),
            children: n(v.label)
          }, v.id))
        }) : s.jsx("div", {
          className: "rounded-2xl bg-white border border-[var(--kb-line)] p-5 text-sm space-y-2",
          children: wa.map(v => {
            const k = v.options.find(w => w.id === e[v.key]);
            return s.jsxs("div", {
              className: "flex items-center gap-3",
              children: [s.jsx("span", {
                className: "kb-option-icon",
                children: s.jsx(I, {
                  name: k.icon,
                  className: "w-4 h-4"
                })
              }), s.jsx("span", {
                className: "text-[var(--kb-muted)] w-28",
                children: n(N.steps[wa.indexOf(v)])
              }), s.jsx("b", {
                children: n(k.label)
              })]
            }, v.key)
          })
        }), s.jsxs("div", {
          className: "mt-6 flex flex-wrap gap-3 justify-between",
          children: [s.jsx("div", {
            className: "flex gap-2",
            children: l > 0 && s.jsx(W, {
              variant: "ghost",
              onClick: l === 4 ? h : p,
              icon: l === 4 ? "RotateCcw" : r === "ar" ? "ArrowRight" : "ArrowLeft",
              children: n(l === 4 ? N.restart : N.back)
            })
          }), l < 4 && s.jsx(W, {
            variant: l === 3 ? "gold" : "primary",
            onClick: g,
            icon: l === 3 ? "Sparkles" : r === "ar" ? "ArrowLeft" : "ArrowRight",
            children: n(l === 3 ? N.generate : N.next)
          })]
        })]
      }), s.jsx("div", {
        className: "lg:sticky lg:top-24",
        children: i || l === 4 ? s.jsx(_m, {
          selection: e
        }, JSON.stringify(e) + r) : s.jsx("div", {
          className: "rounded-3xl border-2 border-dashed border-[var(--kb-line)] p-8 text-center min-h-[320px] grid place-items-center",
          children: s.jsxs("div", {
            children: [s.jsx("div", {
              className: "mx-auto w-14 h-14 rounded-2xl bg-[var(--kb-gold-soft)] grid place-items-center text-[#9A5F00] mb-4",
              children: s.jsx(I, {
                name: "Bot",
                className: "w-7 h-7"
              })
            }), s.jsx("p", {
              className: "kb-display text-xl font-extrabold",
              children: r === "ar" ? "بطاقة وكيلك ستظهر هنا" : "Your agent card appears here"
            }), s.jsx("p", {
              className: "text-sm text-[var(--kb-muted)] mt-2 max-w-xs mx-auto",
              children: r === "ar" ? "تتحدّث البطاقة مع كل اختيار: الاسم، الدور، المهام، والأثر المتوقّع." : "It updates with every choice: name, role, tasks, and estimated impact."
            })]
          })
        })
      })]
    })]
  })
}
const Jm = {
  price: {
    en: "Haircut 8 JD, beard 4 JD. Book a time?",
    ar: "القصّة 8 دنانير والذقن 4. أحجز لك موعدًا؟"
  },
  hours: {
    en: "Open until 11 pm today.",
    ar: "مفتوح حتى 11 مساءً اليوم."
  },
  booking: {
    en: "Booked: today 5:30 · #4822",
    ar: "تم الحجز: اليوم 5:30 · 4822"
  },
  location: {
    en: "Wasfi Al-Tal St., 2nd floor. Map pin sent 📍",
    ar: "شارع وصفي التل، الطابق الثاني. أرسلت الموقع 📍"
  },
  offer: {
    en: "15% off weekdays before 4 pm. Want a slot?",
    ar: "خصم 15% أيام الأسبوع قبل 4 مساءً. أحجز لك؟"
  },
  urgent: {
    en: "Handed to Omar with full context.",
    ar: "تم التحويل لعمر مع كامل السياق."
  }
};

function Xm() {
  const {
    t: e,
    lang: t
  } = V(), [n, r] = C.useState("idle"), [l, a] = C.useState(0), [i, o] = C.useState(0), [u, c] = C.useState(0), g = C.useRef([]), p = () => {
    g.current.forEach(clearTimeout), g.current = []
  };
  C.useEffect(() => p, []);
  const h = () => {
      p(), r("rush"), a(0), o(0), c(0), Qt.forEach((d, m) => g.current.push(setTimeout(() => a(m + 1), 350 + m * 520)));
      const f = setInterval(() => c(d => d + 7), 220);
      g.current.push(setTimeout(() => clearInterval(f), 6e3))
    },
    v = () => {
      p(), r("rescued"), Qt.forEach((f, d) => g.current.push(setTimeout(() => o(d + 1), 300 + d * 420))), g.current.push(setTimeout(() => r("done"), 300 + Qt.length * 420 + 500))
    },
    k = () => {
      p(), r("idle"), a(0), o(0), c(0)
    },
    w = Math.max(0, l - i),
    _ = Qt.slice(0, n === "idle" ? 0 : l);
  return s.jsxs(ze, {
    id: "rescue",
    tone: "dark",
    className: "relative overflow-hidden",
    children: [s.jsx("div", {
      className: "absolute inset-0 opacity-40 bg-[radial-gradient(60%_50%_at_20%_10%,rgba(31,107,255,.35),transparent),radial-gradient(40%_40%_at_90%_90%,rgba(242,179,61,.18),transparent)]",
      "aria-hidden": "true"
    }), s.jsxs("div", {
      className: "relative",
      children: [s.jsx(Ke, {
        tone: "dark",
        children: e(N.inboxEyebrow)
      }), s.jsx(Ye, {
        tone: "dark",
        children: e(N.inboxTitle)
      }), s.jsxs("div", {
        className: "mt-10 grid lg:grid-cols-[1.1fr_.9fr] gap-8 items-start",
        children: [s.jsxs("div", {
          className: "rounded-3xl bg-white/[.04] border border-white/10 p-4 md:p-6 min-h-[420px]",
          children: [s.jsxs("div", {
            className: "flex items-center justify-between mb-4",
            children: [s.jsxs("div", {
              className: "flex items-center gap-2 text-sm font-bold",
              children: [s.jsx(I, {
                name: "Inbox",
                className: "w-4 h-4 text-[var(--kb-signal)]"
              }), t === "ar" ? "صندوق الرسائل" : "Inbox"]
            }), s.jsxs("div", {
              className: "flex items-center gap-3 text-sm tabular-nums",
              children: [s.jsxs("span", {
                className: `px-2.5 py-1 rounded-full font-bold ${w>0?"bg-[rgba(226,75,75,.25)] text-[#ffb4b4]":"bg-[rgba(28,190,120,.2)] text-[#9ff0c9]"}`,
                children: [w, " ", e(N.unanswered)]
              }), n === "rush" && s.jsxs("span", {
                className: "text-[#ffd28a] font-bold",
                children: [u, "s ", e(N.waiting)]
              })]
            })]
          }), s.jsxs("div", {
            className: "kb-inbox",
            children: [n === "idle" && s.jsx("p", {
              className: "text-sm text-[#B8C4DA] py-10 text-center",
              children: t === "ar" ? 'اضغط "ابدأ الضغط" لترى ست رسائل تصل في وقت واحد.' : 'Press "Start the rush" to see six messages land at once.'
            }), _.map((f, d) => {
              const m = d < i;
              return s.jsxs("div", {
                className: `kb-msg ${m?"is-answered":f.intent==="urgent"?"is-urgent":""}`,
                children: [s.jsx("span", {
                  className: `w-9 h-9 rounded-full grid place-items-center shrink-0 ${m?"bg-[rgba(28,190,120,.25)]":"bg-white/10"}`,
                  children: s.jsx(I, {
                    name: f.icon,
                    className: "w-4 h-4"
                  })
                }), s.jsxs("div", {
                  className: "min-w-0 flex-1",
                  children: [s.jsx("p", {
                    className: "font-semibold text-[15px] truncate",
                    children: e(f)
                  }), m && s.jsxs("p", {
                    className: "text-[13px] text-[#9ff0c9] mt-0.5 flex items-center gap-1.5",
                    children: [s.jsx(Nr, {
                      size: 14
                    }), e(Jm[f.intent])]
                  })]
                }), m ? s.jsx("span", {
                  className: "kb-tag",
                  children: e(Cp[f.intent])
                }) : s.jsx("span", {
                  className: "text-xs text-[#ffb4b4] font-bold whitespace-nowrap",
                  children: t === "ar" ? "بلا ردّ" : "no reply"
                })]
              }, d)
            })]
          }), s.jsxs("div", {
            className: "mt-5 flex flex-wrap gap-3",
            children: [n === "idle" && s.jsx(W, {
              variant: "primary",
              icon: "Play",
              onClick: h,
              children: e(N.inboxStart)
            }), n === "rush" && s.jsx(W, {
              variant: "gold",
              icon: "Zap",
              onClick: v,
              disabled: l < Qt.length,
              className: l < Qt.length ? "opacity-60" : "",
              children: e(N.inboxActivate)
            }), (n === "rescued" || n === "done") && s.jsx(W, {
              variant: "ghostDark",
              icon: "RotateCcw",
              onClick: k,
              children: e(N.inboxReplay)
            })]
          })]
        }), s.jsxs("div", {
          className: "grid gap-4",
          children: [s.jsxs("div", {
            className: "grid grid-cols-2 gap-3",
            children: [s.jsx("div", {
              className: "text-xs font-bold uppercase tracking-wider text-[#B8C4DA]",
              children: e(N.before)
            }), s.jsx("div", {
              className: "text-xs font-bold uppercase tracking-wider text-[var(--kb-signal)]",
              children: e(N.after)
            })]
          }), [{
            k: "reply",
            b: "3h",
            a: 5,
            suf: "s",
            label: e(N.stats.reply)
          }, {
            k: "missed",
            b: "4/wk",
            a: 0,
            suf: "",
            label: e(N.stats.missed)
          }, {
            k: "follow",
            b: "0",
            a: 6,
            suf: "",
            label: e(N.stats.follow)
          }, {
            k: "hours",
            b: "0",
            a: 9,
            suf: t === "ar" ? " ساعة" : "h",
            label: e(N.stats.hours)
          }].map(f => s.jsxs("div", {
            className: "grid grid-cols-2 gap-3",
            children: [s.jsxs("div", {
              className: "kb-stat",
              children: [s.jsx("b", {
                className: "text-[#ffb4b4]",
                children: f.b
              }), s.jsx("span", {
                className: "text-xs text-[#B8C4DA]",
                children: f.label
              })]
            }), s.jsxs("div", {
              className: `kb-stat transition-opacity ${n==="done"?"opacity-100":"opacity-40"}`,
              children: [s.jsx("b", {
                className: "text-[#9ff0c9]",
                children: n === "done" ? s.jsx($c, {
                  value: f.a,
                  suffix: f.suf
                }) : "—"
              }), s.jsx("span", {
                className: "text-xs text-[#B8C4DA]",
                children: f.label
              })]
            })]
          }, f.k)), s.jsx("p", {
            className: "text-xs text-[#8FA0BD]",
            children: t === "ar" ? "أرقام توضيحية لصالون بمحادثات يومية متوسطة. تدقيقك المجاني يستخدم أرقامك أنت." : "Illustrative figures for a salon with an average inbox. Your free audit uses your own numbers."
          }), n === "done" && s.jsx(W, {
            variant: "gold",
            icon: "Sparkles",
            href: "#contact",
            className: "justify-self-start",
            children: e(N.ctaShow)
          })]
        })]
      })]
    })]
  })
}
const eh = [{
  id: "msg",
  icon: "MessageSquare",
  module: null
}, {
  id: "intent",
  icon: "Brain",
  module: null,
  gold: !0
}, {
  id: "answer",
  icon: "Zap",
  module: "reply"
}, {
  id: "qualify",
  icon: "UserPlus",
  module: "lead"
}, {
  id: "book",
  icon: "CalendarCheck",
  module: "booking"
}, {
  id: "follow",
  icon: "Repeat",
  module: "followup"
}, {
  id: "pay",
  icon: "CreditCard",
  module: "payment"
}, {
  id: "human",
  icon: "UserRound",
  module: "human"
}, {
  id: "report",
  icon: "BarChart3",
  module: "report"
}];

function th() {
  const {
    t: e,
    dir: t
  } = V(), [n, r] = C.useState({
    reply: !0,
    lead: !0,
    booking: !0,
    followup: !0,
    payment: !1,
    report: !0,
    human: !0
  }), [l, a] = C.useState(0), i = eh.filter(u => !u.module || n[u.module]);
  C.useEffect(() => {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const c = setInterval(() => a(g => (g + 1) % i.length), 900);
    return () => clearInterval(c)
  }, [i.length]);
  const o = u => r(c => ({
    ...c,
    [u.id]: u.locked ? !0 : !c[u.id]
  }));
  return s.jsxs(ze, {
    id: "flow",
    tone: "light",
    children: [s.jsx(Ke, {
      children: e(N.flowEyebrow)
    }), s.jsx(Ye, {
      children: e(N.flowTitle)
    }), s.jsx("div", {
      className: "mt-8 flex flex-wrap gap-2",
      children: bp.map(u => s.jsxs("button", {
        type: "button",
        className: `kb-toggle ${n[u.id]?"is-on":""}`,
        "aria-pressed": n[u.id],
        disabled: u.locked,
        onClick: () => o(u),
        children: [s.jsx("span", {
          className: "kb-switch",
          "aria-hidden": "true"
        }), s.jsx(I, {
          name: u.icon,
          className: "w-4 h-4"
        }), e(u.label), u.locked && s.jsxs("span", {
          className: "text-[11px] text-[var(--kb-muted)] font-bold",
          children: ["· ", e(N.always)]
        })]
      }, u.id))
    }), s.jsx("div", {
      className: "mt-8 rounded-3xl bg-white border border-[var(--kb-line)] p-4 md:p-6",
      children: s.jsx("div", {
        className: "kb-flow",
        role: "list",
        "aria-label": e(N.flowEyebrow),
        children: i.map((u, c) => s.jsxs(Oo.Fragment, {
          children: [s.jsxs("div", {
            role: "listitem",
            className: `kb-node ${c===l?"is-hot":""} ${u.gold?"is-gold":""}`,
            children: [s.jsx("span", {
              className: "kb-node-ic",
              children: s.jsx(I, {
                name: u.icon,
                className: "w-4 h-4"
              })
            }), s.jsx("span", {
              children: e(N.flowNodes[u.id])
            })]
          }), c < i.length - 1 && s.jsx("span", {
            className: "kb-link",
            "aria-hidden": "true",
            children: s.jsx(I, {
              name: t === "rtl" ? "ArrowLeft" : "ArrowRight",
              className: "w-5 h-5"
            })
          })]
        }, u.id))
      })
    }), s.jsxs("div", {
      className: "mt-6 flex flex-col sm:flex-row sm:items-center gap-4",
      children: [s.jsx("p", {
        className: "text-sm text-[var(--kb-muted)] max-w-xl",
        children: e(N.taglines[2])
      }), s.jsx(W, {
        variant: "ghost",
        href: "#contact",
        icon: "ArrowUpRight",
        className: "sm:ms-auto",
        children: e(N.ctaShow)
      })]
    })]
  })
}

function nh() {
  const {
    t: e,
    lang: t
  } = V(), [n, r] = C.useState({
    receptionist: !0,
    report: !0
  }), l = Object.values(n).filter(Boolean).length, a = va.filter(o => n[o.id]).map(o => e(o.name)).join(t === "ar" ? "، " : ", "), i = `https://wa.me/${He}?text=${encodeURIComponent(t==="ar"?`مرحبًا شِفت، أريد فريق كرم بوت من: ${a}`:`Hi SHIFT, I'd like a Karam Bot team of: ${a}`)}`;
  return s.jsxs(ze, {
    id: "team",
    tone: "white",
    children: [s.jsxs("div", {
      className: "flex flex-col md:flex-row md:items-end gap-6 justify-between",
      children: [s.jsxs("div", {
        children: [s.jsx(Ke, {
          children: e(N.teamEyebrow)
        }), s.jsx(Ye, {
          children: e(N.teamTitle)
        })]
      }), s.jsxs("div", {
        className: "flex items-center gap-3 rounded-2xl bg-[var(--kb-gold-soft)] border border-[#F3DDAA] px-4 py-3",
        children: [s.jsx("div", {
          className: "flex -space-x-2 rtl:space-x-reverse",
          children: va.filter(o => n[o.id]).slice(0, 4).map(o => s.jsx("span", {
            className: "w-8 h-8 rounded-full bg-[var(--kb-gold)] border-2 border-white grid place-items-center text-[var(--kb-ink)]",
            children: s.jsx(I, {
              name: o.icon,
              className: "w-4 h-4"
            })
          }, o.id))
        }), s.jsxs("p", {
          className: "text-sm font-bold",
          children: [s.jsx("span", {
            className: "tabular-nums",
            children: l
          }), " ", e(N.teamTray)]
        }), s.jsx(W, {
          size: "sm",
          variant: "primary",
          href: i,
          target: "_blank",
          rel: "noopener",
          icon: "ArrowUpRight",
          children: e(N.teamTrayCta)
        })]
      })]
    }), s.jsx("div", {
      className: "mt-10 grid sm:grid-cols-2 lg:grid-cols-3 gap-5",
      children: va.map(o => {
        const u = !!n[o.id];
        return s.jsxs("article", {
          className: `kb-team ${u?"is-on":""}`,
          children: [s.jsxs("div", {
            className: "flex items-center gap-3",
            children: [s.jsx("span", {
              className: `w-11 h-11 rounded-2xl grid place-items-center ${u?"bg-[var(--kb-gold)] text-[var(--kb-ink)]":"bg-[var(--kb-electric-soft)] text-[var(--kb-electric)]"}`,
              children: s.jsx(I, {
                name: o.icon,
                className: "w-5 h-5"
              })
            }), s.jsx("h3", {
              className: "kb-display text-lg font-extrabold leading-tight",
              children: e(o.name)
            })]
          }), s.jsx("p", {
            className: "text-sm text-[var(--kb-muted)]",
            children: e(o.desc)
          }), s.jsx("p", {
            className: "kb-example",
            children: e(o.example)
          }), s.jsxs("p", {
            className: "text-xs text-[var(--kb-muted)]",
            children: [s.jsxs("b", {
              className: "text-[var(--kb-ink)]",
              children: [e(N.bestFor), ":"]
            }), " ", o.best.map(c => e(Ce.find(g => g.id === c).label)).join(" · ")]
          }), s.jsxs("button", {
            type: "button",
            "aria-pressed": u,
            onClick: () => r(c => ({
              ...c,
              [o.id]: !c[o.id]
            })),
            className: `mt-auto kb-btn inline-flex items-center justify-center gap-2 h-11 rounded-full font-semibold text-sm border transition-all ${u?"bg-[var(--kb-ink)] text-white border-[var(--kb-ink)]":"bg-white text-[var(--kb-ink)] border-[var(--kb-line)] hover:border-[var(--kb-ink)]"}`,
            children: [s.jsx(I, {
              name: u ? "Check" : "Plus",
              className: "w-4 h-4"
            }), e(u ? N.added : N.addTeam)]
          })]
        }, o.id)
      })
    })]
  })
}

function rh() {
  const {
    t: e,
    lang: t
  } = V(), [n, r] = C.useState(xa[0].id), [l, a] = C.useState(0), [i, o] = C.useState(!1), u = C.useRef([]), c = xa.find(g => g.id === n).script;
  return C.useEffect(() => {
    if (u.current.forEach(clearTimeout), u.current = [], a(0), o(!1), window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      a(c.length);
      return
    }
    let p = 300;
    return c.forEach((h, v) => {
      h.from === "k" && (u.current.push(setTimeout(() => o(!0), p)), p += 900), u.current.push(setTimeout(() => {
        o(!1), a(v + 1)
      }, p)), p += 700
    }), () => u.current.forEach(clearTimeout)
  }, [n, t, c]), s.jsxs(ze, {
    id: "demo",
    tone: "light",
    children: [s.jsx(Ke, {
      children: e(N.demoEyebrow)
    }), s.jsx(Ye, {
      children: e(N.demoTitle)
    }), s.jsxs("div", {
      className: "mt-10 grid lg:grid-cols-[.9fr_1.1fr] gap-8 items-start",
      children: [s.jsxs("div", {
        role: "radiogroup",
        "aria-label": e(N.demoEyebrow),
        className: "grid gap-3",
        children: [xa.map(g => s.jsx(Sn, {
          selected: n === g.id,
          onClick: () => r(g.id),
          icon: "MessageCircle",
          children: e(g.label)
        }, g.id)), s.jsx("p", {
          className: "text-sm text-[var(--kb-muted)] mt-2",
          children: e(N.taglines[1])
        }), s.jsx(W, {
          variant: "primary",
          href: "#contact",
          icon: "ArrowUpRight",
          className: "justify-self-start mt-2",
          children: e(N.ctaStart)
        })]
      }), s.jsx("div", {
        className: "kb-device max-w-[460px] w-full mx-auto lg:mx-0",
        children: s.jsxs("div", {
          className: "kb-screen",
          children: [s.jsxs("div", {
            className: "kb-chat-head",
            children: [s.jsx(Nr, {
              size: 34
            }), s.jsxs("div", {
              className: "leading-tight",
              children: [s.jsx("p", {
                className: "text-sm font-bold text-[#111B21]",
                children: e(N.demoAgent)
              }), s.jsx("p", {
                className: "text-[11px] text-[#54656F]",
                children: e(i ? N.typing : N.online)
              })]
            }), s.jsx(I, {
              name: "Lock",
              className: "w-4 h-4 ms-auto text-[#8696A0]"
            })]
          }), s.jsxs("div", {
            className: "kb-chat-body",
            children: [c.slice(0, l).map((g, p) => s.jsx("div", {
              className: `kb-bubble ${g.from==="k"?"in":"out"}`,
              children: e(g)
            }, `${n}-${p}-${t}`)), i && s.jsx("div", {
              className: "kb-bubble in",
              children: s.jsxs("span", {
                className: "kb-typing",
                children: [s.jsx("i", {}), s.jsx("i", {}), s.jsx("i", {})]
              })
            })]
          })]
        })
      })]
    })]
  })
}

function lh() {
  var i;
  const {
    t: e
  } = V(), [t, n] = C.useState("restaurant"), r = Co.find(o => o.id === t), l = ((i = Ce.find(o => o.id === t)) == null ? void 0 : i.icon) || "Briefcase", a = [{
    k: "problem",
    icon: "AlertTriangle",
    tone: "text-[#B45309] bg-[#FFF7E6]"
  }, {
    k: "solution",
    icon: "Sparkles",
    tone: "text-[var(--kb-electric)] bg-[var(--kb-electric-soft)]"
  }, {
    k: "example",
    icon: "Quote",
    tone: "text-[#7A4B00] bg-[var(--kb-gold-soft)]"
  }, {
    k: "result",
    icon: "Trophy",
    tone: "text-[var(--kb-ok)] bg-[var(--kb-ok-soft)]"
  }];
  return s.jsxs(ze, {
    id: "cases",
    tone: "white",
    children: [s.jsx(Ke, {
      children: e(N.casesEyebrow)
    }), s.jsx(Ye, {
      children: e(N.casesTitle)
    }), s.jsx("div", {
      className: "kb-tabs mt-8",
      role: "tablist",
      "aria-label": e(N.casesEyebrow),
      children: Co.map(o => s.jsx("button", {
        role: "tab",
        "aria-selected": t === o.id,
        className: "kb-tab",
        onClick: () => n(o.id),
        children: e(o.label)
      }, o.id))
    }), s.jsxs("div", {
      className: "mt-6 rounded-3xl border border-[var(--kb-line)] bg-[var(--kb-ground)] p-5 md:p-8 kb-card-enter",
      role: "tabpanel",
      children: [s.jsxs("div", {
        className: "flex items-center gap-3 mb-6",
        children: [s.jsx("span", {
          className: "w-12 h-12 rounded-2xl bg-white border border-[var(--kb-line)] grid place-items-center text-[var(--kb-electric)]",
          children: s.jsx(I, {
            name: l,
            className: "w-6 h-6"
          })
        }), s.jsx("h3", {
          className: "kb-display text-2xl font-extrabold",
          children: e(r.label)
        })]
      }), s.jsx("div", {
        className: "grid md:grid-cols-2 xl:grid-cols-4 gap-4",
        children: a.map(o => s.jsxs("div", {
          className: "rounded-2xl bg-white border border-[var(--kb-line)] p-5",
          children: [s.jsxs("span", {
            className: `inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full ${o.tone}`,
            children: [s.jsx(I, {
              name: o.icon,
              className: "w-3.5 h-3.5"
            }), e(N.caseCols[o.k])]
          }), s.jsx("p", {
            className: `mt-3 text-[15px] leading-relaxed ${o.k==="example"?"kb-example":"text-[var(--kb-ink-2)]"}`,
            children: e(r[o.k])
          })]
        }, o.k))
      })]
    }, t)]
  })
}
const ja = [{
  id: "restaurant",
  icon: "UtensilsCrossed",
  label: {
    en: "Restaurant",
    ar: "مطعم"
  },
  brand: {
    en: "Olive Café",
    ar: "كافيه زيتون"
  },
  reward: {
    en: "a free meal",
    ar: "وجبة مجانية"
  },
  ticket: 12
}, {
  id: "clinic",
  icon: "Stethoscope",
  label: {
    en: "Clinic",
    ar: "عيادة"
  },
  brand: {
    en: "Smile Dental",
    ar: "عيادة سمايل"
  },
  reward: {
    en: "a free cleaning session",
    ar: "جلسة تنظيف مجانية"
  },
  ticket: 40
}, {
  id: "salon",
  icon: "Scissors",
  label: {
    en: "Salon",
    ar: "صالون"
  },
  brand: {
    en: "Glow Salon",
    ar: "صالون جلو"
  },
  reward: {
    en: "a free blow-dry",
    ar: "سشوار مجاني"
  },
  ticket: 15
}, {
  id: "playground",
  icon: "PartyPopper",
  label: {
    en: "Kids center",
    ar: "مركز أطفال"
  },
  brand: {
    en: "Happy Kids",
    ar: "هابي كيدز"
  },
  reward: {
    en: "a free entry ticket",
    ar: "تذكرة دخول مجانية"
  },
  ticket: 8
}];

function Na({
  id: e,
  label: t,
  value: n,
  min: r,
  max: l,
  step: a = 1,
  onChange: i,
  format: o = u => u
}) {
  const u = (n - r) / (l - r) * 100;
  return s.jsxs("div", {
    children: [s.jsxs("div", {
      className: "flex items-center justify-between mb-2",
      children: [s.jsx("label", {
        htmlFor: e,
        className: "kb-label !mb-0",
        children: t
      }), s.jsx("span", {
        className: "kb-display font-extrabold tabular-nums text-[var(--kb-electric)]",
        children: o(n)
      })]
    }), s.jsx("input", {
      id: e,
      type: "range",
      className: "kb-range",
      style: {
        "--p": `${u}%`
      },
      min: r,
      max: l,
      step: a,
      value: n,
      onChange: c => i(Number(c.target.value))
    })]
  })
}
const Sa = {
  visits: 0,
  balance: 0,
  lifetime: 0,
  issued: 0,
  redeemed: 0,
  events: []
};

function ah() {
  const {
    t: e,
    lang: t
  } = V(), n = R.loy, [r, l] = C.useState("restaurant"), a = ja.find(y => y.id === r), [i, o] = C.useState(1), [u, c] = C.useState(100), [g, p] = C.useState(a.ticket), [h, v] = C.useState(Sa), k = y => {
    l(y), p(ja.find(F => F.id === y).ticket), v(Sa)
  }, w = Math.max(1, Math.round(g * i)), _ = h.balance >= u, f = Math.max(0, u - h.balance), d = Math.min(100, Math.round(h.balance / u * 100)), m = h.lifetime >= u * 5 ? "gold" : h.lifetime >= u * 2 ? "silver" : "bronze", x = () => v(y => {
    const F = y.balance + w,
      L = [...y.events, {
        k: "earn",
        earn: w,
        balance: F,
        remaining: Math.max(0, u - F)
      }];
    return F >= u && y.balance < u && L.push({
      k: "unlock"
    }), {
      ...y,
      visits: y.visits + 1,
      balance: F,
      lifetime: y.lifetime + w,
      issued: y.issued + w,
      events: L.slice(-6)
    }
  }), S = () => v(y => ({
    ...y,
    balance: y.balance - u,
    redeemed: y.redeemed + 1,
    events: [...y.events, {
      k: "redeem"
    }].slice(-6)
  })), E = y => {
    const F = e(a.brand),
      L = e(a.reward);
    return y.k === "earn" ? t === "ar" ? `كسبتِ ${y.earn} نقطة في ${F}. رصيدك ${y.balance} نقطة، وبقي ${y.remaining} نقطة حتى ${L}.` : `You earned ${y.earn} points at ${F}. Balance: ${y.balance}. ${y.remaining} points to ${L}.` : y.k === "unlock" ? t === "ar" ? `🎁 مكافأتك جاهزة: ${L}. أظهري هذه الرسالة عند الكاشير.` : `🎁 Reward unlocked: ${L}. Show this message at the counter.` : t === "ar" ? `تم استبدال ${L}. بالهناء! نقاطك تستمر بالتراكم.` : `Redeemed ${L}. Enjoy! Your points keep adding up.`
  }, P = C.useMemo(() => [{
    k: "visits",
    v: h.visits,
    icon: "MapPin"
  }, {
    k: "issued",
    v: h.issued,
    icon: "Coins"
  }, {
    k: "redeemed",
    v: h.redeemed,
    icon: "Trophy"
  }], [h]);
  return s.jsxs(ze, {
    id: "loyalty-demo",
    tone: "light",
    children: [s.jsx(Ke, {
      children: e(R.loyEyebrow)
    }), s.jsx(Ye, {
      children: e(R.loyTitle)
    }), s.jsx("p", {
      className: "kb-lead mt-4",
      children: e(R.loySub)
    }), s.jsxs("div", {
      className: "mt-10 grid lg:grid-cols-[1fr_.95fr] gap-8 items-start",
      children: [s.jsxs("div", {
        className: "rounded-3xl bg-white border border-[var(--kb-line)] p-6 md:p-8 grid gap-7",
        children: [s.jsxs("div", {
          children: [s.jsx("p", {
            className: "kb-label",
            children: t === "ar" ? "نوع النشاط" : "Business type"
          }), s.jsx("div", {
            className: "flex flex-wrap gap-2",
            role: "radiogroup",
            children: ja.map(y => s.jsx(Sn, {
              size: "sm",
              icon: y.icon,
              selected: r === y.id,
              onClick: () => k(y.id),
              children: e(y.label)
            }, y.id))
          })]
        }), s.jsx(Na, {
          id: "l-rate",
          label: e(n.rate),
          value: i,
          min: 1,
          max: 10,
          onChange: o,
          format: y => `${y} ${t==="ar"?"نقطة":"pts"}`
        }), s.jsx(Na, {
          id: "l-thr",
          label: e(n.threshold),
          value: u,
          min: 50,
          max: 500,
          step: 25,
          onChange: c,
          format: y => `${y} ${t==="ar"?"نقطة":"pts"}`
        }), s.jsx(Na, {
          id: "l-ticket",
          label: e(n.ticket),
          value: g,
          min: 3,
          max: 100,
          onChange: p,
          format: y => `${y} ${t==="ar"?"دينار":"JD"}`
        }), s.jsxs("div", {
          className: "flex flex-wrap gap-3",
          children: [_ ? s.jsx(W, {
            variant: "gold",
            icon: "Trophy",
            onClick: S,
            children: e(n.redeem)
          }) : s.jsxs(W, {
            variant: "primary",
            icon: "Plus",
            onClick: x,
            children: [e(n.visit), " · +", w]
          }), _ && s.jsx(W, {
            variant: "ghost",
            icon: "Plus",
            onClick: x,
            children: e(n.visit)
          }), s.jsx(W, {
            variant: "ghost",
            icon: "RotateCcw",
            onClick: () => v(Sa),
            children: e(n.reset)
          })]
        }), s.jsx("div", {
          className: "grid grid-cols-3 gap-3",
          children: P.map(y => s.jsxs("div", {
            className: "rounded-2xl bg-[var(--kb-ground)] p-4",
            children: [s.jsx(I, {
              name: y.icon,
              className: "w-4 h-4 text-[var(--kb-electric)]"
            }), s.jsx("p", {
              className: "kb-display text-2xl font-extrabold tabular-nums mt-1",
              children: y.v
            }), s.jsx("p", {
              className: "text-xs text-[var(--kb-muted)]",
              children: e(n[y.k])
            })]
          }, y.k))
        }), s.jsx("p", {
          className: "text-xs text-[var(--kb-muted)]",
          children: e(n.note)
        })]
      }), s.jsxs("div", {
        className: "relative max-w-[440px] w-full mx-auto lg:sticky lg:top-24",
        children: [s.jsx("div", {
          className: "absolute inset-0 lg:-inset-6 rounded-[40px] bg-[radial-gradient(60%_60%_at_50%_40%,rgba(242,179,61,.22),transparent)]",
          "aria-hidden": "true"
        }), s.jsx("div", {
          className: "kb-device relative",
          children: s.jsxs("div", {
            className: "kb-screen",
            children: [s.jsxs("div", {
              className: `kb-member ${m}`,
              children: [s.jsxs("div", {
                className: "flex items-center justify-between",
                children: [s.jsxs("div", {
                  children: [s.jsx("p", {
                    className: "text-[11px] uppercase tracking-wider font-bold opacity-80",
                    children: e(n.member)
                  }), s.jsx("p", {
                    className: "kb-display text-lg font-extrabold leading-tight",
                    children: e(a.brand)
                  })]
                }), s.jsxs("span", {
                  className: "kb-tierpill",
                  children: [s.jsx(I, {
                    name: "Trophy",
                    className: "w-3.5 h-3.5"
                  }), e(n.tiers[m])]
                })]
              }), s.jsxs("div", {
                className: "mt-5 flex items-end justify-between gap-3",
                children: [s.jsxs("div", {
                  children: [s.jsx("p", {
                    className: "text-[11px] uppercase tracking-wider font-bold opacity-80",
                    children: e(n.balance)
                  }), s.jsx("p", {
                    className: "kb-display text-4xl font-extrabold tabular-nums leading-none mt-1",
                    children: h.balance
                  })]
                }), s.jsxs("p", {
                  className: "text-xs opacity-90 text-end",
                  children: [t === "ar" ? "سارة" : "Sara", " · ", h.visits, " ", e(n.visits).toLowerCase()]
                })]
              }), s.jsx("div", {
                className: "kb-progress mt-4",
                role: "progressbar",
                "aria-valuemin": 0,
                "aria-valuemax": u,
                "aria-valuenow": Math.min(u, h.balance),
                children: s.jsx("i", {
                  style: {
                    width: `${d}%`
                  }
                })
              }), s.jsx("p", {
                className: "text-xs mt-2 font-semibold",
                children: _ ? `🎁 ${e(n.unlocked)}: ${e(a.reward)}` : `${f} ${e(n.toReward)}: ${e(a.reward)}`
              })]
            }), s.jsxs("div", {
              className: "kb-chat-head",
              children: [s.jsx("span", {
                className: "w-8 h-8 rounded-full bg-[var(--kb-electric)] text-white grid place-items-center",
                children: s.jsx(I, {
                  name: "Trophy",
                  className: "w-4 h-4"
                })
              }), s.jsxs("div", {
                className: "leading-tight",
                children: [s.jsxs("p", {
                  className: "text-sm font-bold text-[#111B21]",
                  children: [e(a.brand), " · ", t === "ar" ? "الولاء" : "Loyalty"]
                }), s.jsx("p", {
                  className: "text-[11px] text-[#54656F]",
                  children: "WhatsApp"
                })]
              })]
            }), s.jsxs("div", {
              className: "kb-chat-body !min-h-[220px]",
              children: [h.events.length === 0 && s.jsx("div", {
                className: "kb-bubble sys",
                children: t === "ar" ? 'اضغط "زيارة جديدة" لبدء التجربة' : 'Tap "New visit" to start'
              }), h.events.map((y, F) => s.jsx("div", {
                className: `kb-bubble ${y.k==="unlock"?"owner":y.k==="redeem"?"book":"in"}`,
                children: E(y)
              }, `${F}-${y.k}-${t}`))]
            })]
          })
        })]
      })]
    })]
  })
}
const sh = [{
    en: "Ahmad",
    ar: "أحمد"
  }, {
    en: "Sara",
    ar: "سارة"
  }, {
    en: "Omar",
    ar: "عمر"
  }, {
    en: "Lina",
    ar: "لينا"
  }, {
    en: "Yousef",
    ar: "يوسف"
  }, {
    en: "Rana",
    ar: "رنا"
  }, {
    en: "Khaled",
    ar: "خالد"
  }, {
    en: "Dana",
    ar: "دانا"
  }, {
    en: "Ali",
    ar: "علي"
  }, {
    en: "Noor",
    ar: "نور"
  }, {
    en: "Hala",
    ar: "هالة"
  }, {
    en: "Tariq",
    ar: "طارق"
  }],
  ih = [-12, -4, 6, 18, 27, null, -2, 41, 3, -8, 14, null],
  oh = ["08:00", "09:00", "10:00"],
  uh = [{
    id: "finger",
    icon: "ShieldCheck"
  }, {
    id: "qr",
    icon: "Tag"
  }, {
    id: "app",
    icon: "MapPin"
  }],
  Eo = -15,
  Dn = 45,
  ba = 30,
  Vr = (e, t) => {
    const n = Number(e.slice(0, 2)) * 60 + t;
    return `${String(Math.floor(n/60)).padStart(2,"0")}:${String(n%60).padStart(2,"0")}`
  };

function Ao({
  id: e,
  label: t,
  value: n,
  min: r,
  max: l,
  step: a = 1,
  onChange: i,
  format: o = u => u
}) {
  const u = (n - r) / (l - r) * 100;
  return s.jsxs("div", {
    children: [s.jsxs("div", {
      className: "flex items-center justify-between mb-2",
      children: [s.jsx("label", {
        htmlFor: e,
        className: "kb-label !mb-0",
        children: t
      }), s.jsx("span", {
        className: "kb-display font-extrabold tabular-nums text-[var(--kb-electric)]",
        children: o(n)
      })]
    }), s.jsx("input", {
      id: e,
      type: "range",
      className: "kb-range",
      style: {
        "--p": `${u}%`
      },
      min: r,
      max: l,
      step: a,
      value: n,
      onChange: c => i(Number(c.target.value))
    })]
  })
}

function ch() {
  const {
    t: e,
    lang: t
  } = V(), n = R.att, [r, l] = C.useState("09:00"), [a, i] = C.useState(10), [o, u] = C.useState(6), [c, g] = C.useState("finger"), [p, h] = C.useState(null), [v, k] = C.useState(!1), w = C.useRef(null), _ = C.useMemo(() => sh.slice(0, o).map((b, re) => ({
    id: re,
    name: b,
    at: ih[re]
  })), [o]), f = p !== null && p < Dn, d = p !== null && p >= Dn, m = () => {
    if (clearInterval(w.current), k(!1), window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      h(Dn);
      return
    }
    h(Eo), w.current = setInterval(() => h(re => re >= Dn ? (clearInterval(w.current), Dn) : re + 1), 95)
  };
  C.useEffect(() => () => clearInterval(w.current), []), C.useEffect(() => {
    clearInterval(w.current), h(null), k(!1)
  }, [r, a, o]);
  const x = b => p === null ? "idle" : b.at === null ? p >= ba ? "absent" : "idle" : p < b.at ? "idle" : b.at > a ? "late" : "ontime",
    S = _.map(b => ({
      ...b,
      st: x(b)
    })),
    E = S.filter(b => b.st === "ontime" || b.st === "late").length,
    P = S.filter(b => b.st === "late").length,
    y = S.filter(b => b.st === "absent").length,
    F = [...S.filter(b => b.st === "late").map(b => ({
      id: `l${b.id}`,
      at: b.at,
      text: `${e(b.name)} ${e(n.alertLate)} ${b.at} ${e(n.min)} · ${Vr(r,b.at)}`
    })), ...S.filter(b => b.st === "absent").map(b => ({
      id: `a${b.id}`,
      at: ba,
      text: `${e(b.name)} ${e(n.alertAbsent)} · ${Vr(r,ba)}`
    }))].sort((b, re) => b.at - re.at),
    L = {
      hours: E * 8 * 22,
      overtime: Math.round(E * 2.5),
      incidents: P * 4 + y * 2
    };
  return s.jsxs(ze, {
    id: "attendance-demo",
    tone: "white",
    children: [s.jsx(Ke, {
      children: e(R.attEyebrow)
    }), s.jsx(Ye, {
      children: e(R.attTitle)
    }), s.jsx("p", {
      className: "kb-lead mt-4",
      children: e(R.attSub)
    }), s.jsxs("div", {
      className: "mt-10 grid lg:grid-cols-[.9fr_1.1fr] gap-8 items-start",
      children: [s.jsxs("div", {
        className: "grid gap-5",
        children: [s.jsxs("div", {
          className: "rounded-3xl bg-[var(--kb-ground)] border border-[var(--kb-line)] p-6 md:p-8 grid gap-6",
          children: [s.jsxs("div", {
            children: [s.jsx("p", {
              className: "kb-label",
              children: e(n.start)
            }), s.jsx("div", {
              className: "flex flex-wrap gap-2",
              role: "radiogroup",
              children: oh.map(b => s.jsx(Sn, {
                size: "sm",
                icon: "Clock",
                selected: r === b,
                onClick: () => l(b),
                children: s.jsx("span", {
                  dir: "ltr",
                  className: "tabular-nums",
                  children: b
                })
              }, b))
            })]
          }), s.jsx(Ao, {
            id: "a-grace",
            label: e(n.grace),
            value: a,
            min: 0,
            max: 30,
            step: 5,
            onChange: i,
            format: b => `${b} ${e(n.min)}`
          }), s.jsx(Ao, {
            id: "a-staff",
            label: e(n.staff),
            value: o,
            min: 4,
            max: 12,
            onChange: u
          }), s.jsxs("div", {
            children: [s.jsx("p", {
              className: "kb-label",
              children: e(n.method)
            }), s.jsx("div", {
              className: "flex flex-wrap gap-2",
              role: "radiogroup",
              children: uh.map(b => s.jsx(Sn, {
                size: "sm",
                icon: b.icon,
                selected: c === b.id,
                onClick: () => g(b.id),
                children: e(n.methods[b.id])
              }, b.id))
            })]
          }), s.jsx("div", {
            className: "flex flex-wrap gap-3",
            children: s.jsx(W, {
              variant: "primary",
              icon: f ? "Clock" : "Play",
              onClick: m,
              disabled: f,
              children: e(f ? n.running : d ? n.replay : n.run)
            })
          })]
        }), s.jsxs("div", {
          className: "rounded-3xl bg-white border border-[var(--kb-line)] p-6",
          children: [s.jsxs("p", {
            className: "text-xs font-bold uppercase tracking-wider text-[var(--kb-muted)] flex items-center gap-2",
            children: [s.jsx(I, {
              name: "BellRing",
              className: "w-4 h-4 text-[var(--kb-gold)]"
            }), e(n.manager), " · ", e(n.whatsapp)]
          }), s.jsxs("div", {
            className: "mt-3 grid gap-2",
            children: [F.length === 0 && s.jsx("p", {
              className: "text-sm text-[var(--kb-muted)]",
              children: e(n.noAlerts)
            }), F.map(b => s.jsx("div", {
              className: "kb-bubble owner !max-w-none",
              children: b.text
            }, `${b.id}-${t}`))]
          })]
        })]
      }), s.jsxs("div", {
        className: "grid gap-4",
        children: [s.jsxs("div", {
          className: "rounded-3xl bg-[var(--kb-ink)] text-white p-5 md:p-6",
          children: [s.jsxs("div", {
            className: "flex items-center justify-between gap-3",
            children: [s.jsx("p", {
              className: "text-xs font-bold uppercase tracking-wider text-[var(--kb-signal)]",
              children: e(n.board)
            }), s.jsx("p", {
              className: "kb-display text-2xl font-extrabold tabular-nums",
              dir: "ltr",
              children: Vr(r, p === null ? Eo : p)
            })]
          }), s.jsx("ul", {
            className: "mt-4 grid gap-2",
            children: S.map(b => s.jsxs("li", {
              className: `kb-att ${b.st}`,
              children: [s.jsx("span", {
                className: "kb-att-avatar",
                children: e(b.name).slice(0, 1)
              }), s.jsx("span", {
                className: "font-semibold flex-1 truncate",
                children: e(b.name)
              }), s.jsx("span", {
                className: "text-xs text-white/60 tabular-nums",
                dir: "ltr",
                children: b.st === "ontime" || b.st === "late" ? Vr(r, b.at) : "—"
              }), s.jsxs("span", {
                className: "kb-att-pill",
                children: [b.st === "idle" && s.jsxs(s.Fragment, {
                  children: [s.jsx(I, {
                    name: "Clock",
                    className: "w-3 h-3"
                  }), e(n.waiting)]
                }), b.st === "ontime" && s.jsxs(s.Fragment, {
                  children: [s.jsx(I, {
                    name: "CheckCircle2",
                    className: "w-3 h-3"
                  }), e(n.ontime)]
                }), b.st === "late" && s.jsxs(s.Fragment, {
                  children: [s.jsx(I, {
                    name: "AlertTriangle",
                    className: "w-3 h-3"
                  }), e(n.lateBy), " ", b.at, " ", e(n.min)]
                }), b.st === "absent" && s.jsxs(s.Fragment, {
                  children: [s.jsx(I, {
                    name: "UserX",
                    className: "w-3 h-3"
                  }), e(n.absent)]
                })]
              })]
            }, b.id))
          }), s.jsx("div", {
            className: "mt-4 grid grid-cols-3 gap-2",
            children: [
              ["present", E, "text-[#7EE2A8]"],
              ["late", P, "text-[var(--kb-gold)]"],
              ["absent", y, "text-[#FF8A8A]"]
            ].map(([b, re, qe]) => s.jsxs("div", {
              className: "kb-stat",
              children: [s.jsx("b", {
                className: qe,
                children: re
              }), s.jsx("span", {
                className: "text-xs text-white/70",
                children: e(n[b])
              })]
            }, b))
          })]
        }), s.jsxs("div", {
          className: "rounded-3xl bg-white border border-[var(--kb-line)] p-6 grid sm:grid-cols-[1fr_auto] gap-4 items-center",
          children: [s.jsxs("div", {
            children: [s.jsx("p", {
              className: "text-xs font-bold uppercase tracking-wider text-[var(--kb-muted)]",
              children: e(n.month)
            }), s.jsxs("div", {
              className: "mt-3 flex flex-wrap gap-x-6 gap-y-2",
              children: [s.jsxs("p", {
                children: [s.jsx("span", {
                  className: "kb-display text-2xl font-extrabold tabular-nums",
                  children: L.hours.toLocaleString()
                }), " ", s.jsx("span", {
                  className: "text-xs text-[var(--kb-muted)]",
                  children: e(n.hours)
                })]
              }), s.jsxs("p", {
                children: [s.jsx("span", {
                  className: "kb-display text-2xl font-extrabold tabular-nums",
                  children: L.overtime
                }), " ", s.jsx("span", {
                  className: "text-xs text-[var(--kb-muted)]",
                  children: e(n.overtime)
                })]
              }), s.jsxs("p", {
                children: [s.jsx("span", {
                  className: "kb-display text-2xl font-extrabold tabular-nums",
                  children: L.incidents
                }), " ", s.jsx("span", {
                  className: "text-xs text-[var(--kb-muted)]",
                  children: e(n.incidents)
                })]
              })]
            }), v && s.jsxs("p", {
              className: "mt-3 text-sm font-semibold text-[var(--kb-ok)] flex items-center gap-2",
              role: "status",
              children: [s.jsx(I, {
                name: "CheckCircle2",
                className: "w-4 h-4"
              }), e(n.exported)]
            })]
          }), s.jsx(W, {
            variant: "ghost",
            icon: "FileBarChart",
            onClick: () => k(!0),
            children: e(n.exportBtn)
          })]
        }), s.jsx("p", {
          className: "text-xs text-[var(--kb-muted)]",
          children: e(n.note)
        })]
      })]
    })]
  })
}

function It({
  id: e,
  label: t,
  value: n,
  min: r,
  max: l,
  step: a = 1,
  onChange: i,
  format: o = u => u
}) {
  const u = (n - r) / (l - r) * 100;
  return s.jsxs("div", {
    children: [s.jsxs("div", {
      className: "flex items-center justify-between mb-2",
      children: [s.jsx("label", {
        htmlFor: e,
        className: "kb-label !mb-0",
        children: t
      }), s.jsx("span", {
        className: "kb-display font-extrabold tabular-nums text-[var(--kb-electric)]",
        children: o(n)
      })]
    }), s.jsx("input", {
      id: e,
      type: "range",
      className: "kb-range",
      style: {
        "--p": `${u}%`
      },
      min: r,
      max: l,
      step: a,
      value: n,
      onChange: c => i(Number(c.target.value))
    })]
  })
}
const dh = {
    restaurant: {
      en: "Order-taking on WhatsApp, then loyalty points at the counter",
      ar: "استقبال الطلبات على واتساب، ثم نقاط الولاء عند الكاشير"
    },
    clinic: {
      en: "Appointment booking with reminders, then staff attendance",
      ar: "حجز المواعيد مع التذكيرات، ثم دوام الموظفين"
    },
    playground: {
      en: "Birthday package quotes, then subscriptions and loyalty",
      ar: "تسعير باقات أعياد الميلاد، ثم الاشتراكات والولاء"
    },
    salon: {
      en: "Booking by stylist, then loyalty rewards for regulars",
      ar: "الحجز حسب المصفّف، ثم مكافآت الولاء للزبائن الدائمين"
    },
    realestate: {
      en: "Lead qualification and viewing booking on WhatsApp",
      ar: "قياس جدية العميل وحجز المعاينات على واتساب"
    },
    general: {
      en: "Instant WhatsApp replies, then a custom automation audit",
      ar: "ردود واتساب فورية، ثم تدقيق أتمتة مخصّص"
    }
  },
  Po = ["karam", "loyalty", "attend"],
  Zt = e => e === "ar" ? "دينار" : "JD",
  fh = e => e === "ar" ? "ساعة" : "h";

function ph() {
  const {
    t: e,
    lang: t
  } = V(), n = R.roi, [r, l] = C.useState({
    karam: !0,
    loyalty: !0,
    attend: !1
  }), [a, i] = C.useState(60), [o, u] = C.useState(3), [c, g] = C.useState(5), [p, h] = C.useState(400), [v, k] = C.useState(12), [w, _] = C.useState(6), [f, d] = C.useState(4), [m, x] = C.useState("restaurant"), S = C.useMemo(() => {
    const y = r.karam ? a * o * 30 / 60 * .8 : 0,
      F = r.attend ? w * .75 * 4 : 0,
      L = Math.round(y + F),
      b = r.karam ? Math.round(c * 4 * .6) : 0,
      re = r.loyalty ? Math.round(p * .12) : 0,
      qe = (b + re) * v,
      An = L * f;
    return {
      hours: L,
      leads: b,
      visits: re,
      revenue: qe,
      value: An,
      total: qe + An
    }
  }, [r, a, o, c, p, v, w, f]), E = Po.filter(y => r[y]).map(y => e(_t(y).name)).join(t === "ar" ? "، " : ", "), P = `https://wa.me/${He}?text=${encodeURIComponent(t==="ar"?`مرحبًا شِفت، أريد تدقيق أتمتة مجاني. النشاط: ${e(Ce.find(y=>y.id===m).label)}. يهمّني: ${E||"كل المنتجات"}. تقدير الموقع: نحو ${S.total.toLocaleString()} دينار شهريًا.`:`Hi SHIFT, I'd like a free automation audit. Business: ${e(Ce.find(y=>y.id===m).label)}. Interested in: ${E||"all products"}. Site estimate: about ${S.total.toLocaleString()} JD/month.`)}`;
  return s.jsxs(ze, {
    id: "roi",
    tone: "light",
    children: [s.jsx(Ke, {
      children: e(R.roiEyebrow)
    }), s.jsx(Ye, {
      children: e(R.roiTitle)
    }), s.jsxs("div", {
      className: "mt-8 flex flex-wrap gap-2 items-center",
      children: [s.jsx("span", {
        className: "text-xs font-bold uppercase tracking-wider text-[var(--kb-muted)] me-2",
        children: e(R.roiPick)
      }), Po.map(y => {
        const F = _t(y),
          L = !!r[y];
        return s.jsxs("button", {
          type: "button",
          className: `kb-toggle ${L?"is-on":""}`,
          "aria-pressed": L,
          onClick: () => l(b => ({
            ...b,
            [y]: !b[y]
          })),
          children: [s.jsx(I, {
            name: F.icon,
            className: "w-4 h-4"
          }), e(F.name), s.jsx("span", {
            className: "kb-switch",
            "aria-hidden": "true"
          })]
        }, y)
      })]
    }), s.jsxs("div", {
      className: "mt-6 grid lg:grid-cols-[1fr_.9fr] gap-8 items-start",
      children: [s.jsxs("div", {
        className: "rounded-3xl bg-white border border-[var(--kb-line)] p-6 md:p-8 grid gap-7",
        children: [r.karam && s.jsxs(s.Fragment, {
          children: [s.jsx(It, {
            id: "r-msgs",
            label: e(N.roi.msgs),
            value: a,
            min: 10,
            max: 400,
            step: 10,
            onChange: i
          }), s.jsx(It, {
            id: "r-reply",
            label: e(N.roi.reply),
            value: o,
            min: 1,
            max: 10,
            onChange: u,
            format: y => `${y} ${t==="ar"?"دقيقة":"min"}`
          }), s.jsx(It, {
            id: "r-missed",
            label: e(N.roi.missed),
            value: c,
            min: 0,
            max: 40,
            onChange: g
          })]
        }), r.loyalty && s.jsx(It, {
          id: "r-cust",
          label: e(n.customers),
          value: p,
          min: 50,
          max: 3e3,
          step: 50,
          onChange: h
        }), r.attend && s.jsx(It, {
          id: "r-staff",
          label: e(n.staff),
          value: w,
          min: 2,
          max: 60,
          onChange: _
        }), (r.karam || r.loyalty) && s.jsx(It, {
          id: "r-ticket",
          label: e(n.ticket),
          value: v,
          min: 3,
          max: 200,
          onChange: k,
          format: y => `${y} ${Zt(t)}`
        }), s.jsx(It, {
          id: "r-cost",
          label: e(N.roi.cost),
          value: f,
          min: 2,
          max: 20,
          onChange: d,
          format: y => `${y} ${Zt(t)}`
        }), s.jsxs("div", {
          children: [s.jsx("p", {
            className: "kb-label",
            children: e(N.form.business)
          }), s.jsx("div", {
            className: "flex flex-wrap gap-2",
            role: "radiogroup",
            children: Ce.map(y => s.jsx(Sn, {
              size: "sm",
              icon: y.icon,
              selected: m === y.id,
              onClick: () => x(y.id),
              children: e(y.label)
            }, y.id))
          })]
        })]
      }), s.jsxs("div", {
        className: "grid gap-4 lg:sticky lg:top-24",
        children: [s.jsxs("div", {
          className: "grid sm:grid-cols-2 gap-4",
          children: [s.jsxs("div", {
            className: "rounded-3xl bg-[var(--kb-ink)] text-white p-6",
            children: [s.jsx("p", {
              className: "text-xs font-bold uppercase tracking-wider text-[var(--kb-signal)]",
              children: e(N.roi.hours)
            }), s.jsxs("p", {
              className: "kb-display text-5xl font-extrabold tabular-nums mt-2",
              children: [S.hours, s.jsxs("span", {
                className: "text-2xl text-[#B8C4DA]",
                children: [" ", fh(t)]
              })]
            }), s.jsx("p", {
              className: "text-xs text-[#B8C4DA] mt-2",
              children: [r.karam && e(_t("karam").name), r.attend && e(_t("attend").name)].filter(Boolean).join(" + ") || "—"
            })]
          }), s.jsxs("div", {
            className: "rounded-3xl bg-white border border-[var(--kb-line)] p-6",
            children: [s.jsx("p", {
              className: "text-xs font-bold uppercase tracking-wider text-[var(--kb-muted)]",
              children: e(n.revenue)
            }), s.jsxs("p", {
              className: "kb-display text-4xl font-extrabold tabular-nums mt-2 text-[var(--kb-electric)]",
              children: [S.revenue.toLocaleString(), " ", s.jsx("span", {
                className: "text-base text-[var(--kb-muted)]",
                children: Zt(t)
              })]
            }), s.jsxs("p", {
              className: "text-xs text-[var(--kb-muted)] mt-2",
              children: [r.karam ? `${S.leads} ${e(N.roi.recovered).toLowerCase()}` : "", r.karam && r.loyalty ? " · " : "", r.loyalty ? `${S.visits} ${t==="ar"?"زيارة متكررة إضافية":"extra repeat visits"}` : ""]
            })]
          })]
        }), s.jsxs("div", {
          className: "rounded-3xl bg-white border border-[var(--kb-line)] p-6 flex items-center justify-between gap-4",
          children: [s.jsxs("div", {
            children: [s.jsx("p", {
              className: "text-xs font-bold uppercase tracking-wider text-[var(--kb-muted)]",
              children: e(n.total)
            }), s.jsxs("p", {
              className: "kb-display text-3xl font-extrabold tabular-nums mt-1",
              children: [S.total.toLocaleString(), " ", s.jsxs("span", {
                className: "text-base text-[var(--kb-muted)]",
                children: [Zt(t), " / ", t === "ar" ? "شهريًا" : "month"]
              })]
            }), s.jsxs("p", {
              className: "text-xs text-[var(--kb-muted)] mt-1",
              children: [e(N.roi.value), ": ", S.value.toLocaleString(), " ", Zt(t), " · ", e(n.revenue), ": ", S.revenue.toLocaleString(), " ", Zt(t)]
            })]
          }), s.jsx(I, {
            name: "Coins",
            className: "w-10 h-10 text-[var(--kb-gold)] shrink-0"
          })]
        }), s.jsxs("div", {
          className: "rounded-3xl bg-[var(--kb-gold-soft)] border border-[#F3DDAA] p-6",
          children: [s.jsx("p", {
            className: "text-xs font-bold uppercase tracking-wider text-[#9A5F00]",
            children: e(N.roi.first)
          }), s.jsx("p", {
            className: "kb-display text-xl font-extrabold mt-1",
            children: e(dh[m])
          }), s.jsx(W, {
            variant: "primary",
            className: "mt-4",
            href: P,
            target: "_blank",
            rel: "noopener",
            icon: "ClipboardCheck",
            children: e(N.ctaAudit)
          })]
        }), s.jsx("p", {
          className: "text-xs text-[var(--kb-muted)]",
          children: e(n.note)
        })]
      })]
    })]
  })
}

function mh() {
  const {
    t: e
  } = V();
  return s.jsxs(ze, {
    id: "trust",
    tone: "white",
    children: [s.jsx(Ke, {
      children: e(N.trustEyebrow)
    }), s.jsx(Ye, {
      children: e(N.trustTitle)
    }), s.jsx("div", {
      className: "mt-10 grid sm:grid-cols-2 lg:grid-cols-4 gap-5",
      children: N.trust.map((t, n) => s.jsx(Rm, {
        delay: n * 60,
        children: s.jsxs("div", {
          className: "h-full rounded-3xl border border-[var(--kb-line)] bg-[var(--kb-ground)] p-6",
          children: [s.jsx("span", {
            className: "w-11 h-11 rounded-2xl bg-white border border-[var(--kb-line)] grid place-items-center text-[var(--kb-electric)]",
            children: s.jsx(I, {
              name: t.icon,
              className: "w-5 h-5"
            })
          }), s.jsx("h3", {
            className: "kb-display text-lg font-extrabold mt-4",
            children: e(t.t)
          }), s.jsx("p", {
            className: "text-sm text-[var(--kb-muted)] mt-2 leading-relaxed",
            children: e(t.d)
          })]
        })
      }, n))
    }), s.jsx("div", {
      className: "mt-8 flex flex-wrap items-center gap-2",
      children: Ep.map(t => s.jsx("span", {
        className: "text-xs font-bold px-3 py-1.5 rounded-full border border-[var(--kb-line)] text-[var(--kb-ink-2)] bg-white",
        children: t
      }, t))
    })]
  })
}

function hh({
  stack: e,
  setStack: t
}) {
  const {
    t: n,
    lang: r
  } = V(), [l, a] = C.useState({
    name: "",
    business: "restaurant",
    phone: "",
    want: ""
  }), [i, o] = C.useState(!1), u = p => h => a(v => ({
    ...v,
    [p]: h.target.value
  })), c = $e.filter(p => e[p.id]).map(p => n(p.name)).join(r === "ar" ? "، " : ", "), g = p => {
    p.preventDefault();
    const h = n(Ce.find(k => k.id === l.business).label),
      v = r === "ar" ? `مرحبًا شِفت، أرغب بالبدء معكم.
الاسم: ${l.name}
النشاط: ${h}
الهاتف: ${l.phone}
المنتجات: ${c||"لم أحدد بعد"}
أريد أتمتة: ${l.want}` : `Hi SHIFT, I'd like to get started.
Name: ${l.name}
Business: ${h}
Phone: ${l.phone}
Products: ${c||"not sure yet"}
I want to automate: ${l.want}`;
    o(!0), window.open(`https://wa.me/${He}?text=${encodeURIComponent(v)}`, "_blank", "noopener")
  };
  return s.jsxs(ze, {
    id: "contact",
    tone: "dark",
    className: "relative overflow-hidden",
    children: [s.jsx("div", {
      className: "absolute inset-0 bg-[radial-gradient(50%_60%_at_80%_20%,rgba(242,179,61,.22),transparent),radial-gradient(50%_60%_at_10%_90%,rgba(31,107,255,.3),transparent)]",
      "aria-hidden": "true"
    }), s.jsxs("div", {
      className: "relative grid lg:grid-cols-[1fr_1fr] gap-10 items-start",
      children: [s.jsxs("div", {
        children: [s.jsx("img", {
          src: Sr,
          alt: yr,
          className: "h-12 w-auto rounded-xl bg-white p-1.5"
        }), s.jsx("h2", {
          className: "kb-h2 text-white mt-5",
          children: n(R.finalTitle)
        }), s.jsx("p", {
          className: "kb-lead mt-4 text-[#B8C4DA]",
          children: n(R.finalSub)
        }), s.jsxs("div", {
          className: "mt-8 flex flex-col sm:flex-row flex-wrap gap-3",
          children: [s.jsx(W, {
            variant: "gold",
            icon: "ClipboardCheck",
            href: `https://wa.me/${He}?text=${encodeURIComponent(r==="ar"?"مرحبًا شِفت، أريد تدقيق أتمتة مجاني":"Hi SHIFT, I want a free automation audit")}`,
            target: "_blank",
            rel: "noopener",
            children: n(N.ctaAudit)
          }), s.jsx(W, {
            variant: "ghostDark",
            icon: "Layers",
            href: "#products",
            children: n(R.ctaProducts)
          }), s.jsx(W, {
            variant: "wa",
            icon: "MessageCircle",
            href: `https://wa.me/${He}`,
            target: "_blank",
            rel: "noopener",
            children: n(N.ctaWhatsApp)
          })]
        }), s.jsxs("p", {
          className: "mt-8 text-sm text-[#B8C4DA] flex items-center gap-2",
          children: [s.jsx(I, {
            name: "Phone",
            className: "w-4 h-4"
          }), s.jsx("span", {
            className: "tabular-nums",
            dir: "ltr",
            children: Vc
          }), " · karambots.com · ", r === "ar" ? "إربد، الأردن" : "Irbid, Jordan"]
        })]
      }), s.jsxs("form", {
        onSubmit: g,
        className: "rounded-3xl bg-white text-[var(--kb-ink)] p-6 md:p-8 grid gap-4 shadow-[0_40px_80px_-40px_rgba(0,0,0,.6)]",
        children: [s.jsxs("div", {
          children: [s.jsx("p", {
            className: "kb-label",
            children: n(R.formProducts)
          }), s.jsx("div", {
            className: "flex flex-wrap gap-2",
            children: $e.map(p => {
              const h = !!e[p.id];
              return s.jsxs("button", {
                type: "button",
                "aria-pressed": h,
                onClick: () => t(v => ({
                  ...v,
                  [p.id]: !v[p.id]
                })),
                className: `inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-full border transition-all ${h?"bg-[var(--kb-ink)] text-white border-[var(--kb-ink)]":"bg-white text-[var(--kb-ink)] border-[var(--kb-line)] hover:border-[var(--kb-ink)]"}`,
                children: [s.jsx(I, {
                  name: h ? "Check" : p.icon,
                  className: "w-3.5 h-3.5"
                }), n(p.name)]
              }, p.id)
            })
          })]
        }), s.jsxs("div", {
          className: "grid sm:grid-cols-2 gap-4",
          children: [s.jsxs("div", {
            children: [s.jsx("label", {
              htmlFor: "f-name",
              className: "kb-label",
              children: n(N.form.name)
            }), s.jsx("input", {
              id: "f-name",
              required: !0,
              className: "kb-input",
              value: l.name,
              onChange: u("name"),
              autoComplete: "name"
            })]
          }), s.jsxs("div", {
            children: [s.jsx("label", {
              htmlFor: "f-biz",
              className: "kb-label",
              children: n(N.form.business)
            }), s.jsx("select", {
              id: "f-biz",
              className: "kb-input",
              value: l.business,
              onChange: u("business"),
              children: Ce.map(p => s.jsx("option", {
                value: p.id,
                children: n(p.label)
              }, p.id))
            })]
          })]
        }), s.jsxs("div", {
          children: [s.jsx("label", {
            htmlFor: "f-phone",
            className: "kb-label",
            children: n(N.form.phone)
          }), s.jsx("input", {
            id: "f-phone",
            required: !0,
            type: "tel",
            inputMode: "tel",
            className: "kb-input",
            value: l.phone,
            onChange: u("phone"),
            autoComplete: "tel",
            dir: "ltr",
            placeholder: "07x xxx xxxx"
          })]
        }), s.jsxs("div", {
          children: [s.jsx("label", {
            htmlFor: "f-want",
            className: "kb-label",
            children: n(N.form.want)
          }), s.jsx("textarea", {
            id: "f-want",
            className: "kb-input",
            value: l.want,
            onChange: u("want"),
            placeholder: n(N.form.wantPh)
          })]
        }), s.jsx(W, {
          type: "submit",
          variant: "primary",
          size: "lg",
          icon: "Send",
          children: n(N.form.submit)
        }), i && s.jsxs("p", {
          className: "text-sm text-[var(--kb-ok)] font-semibold flex items-center gap-2",
          role: "status",
          children: [s.jsx(I, {
            name: "CheckCircle2",
            className: "w-4 h-4"
          }), n(N.form.sent)]
        }), s.jsx("p", {
          className: "text-xs text-[var(--kb-muted)]",
          children: r === "ar" ? "لا نستخدم رقمك إلا للردّ على طلبك." : "We only use your number to reply to this request."
        })]
      })]
    })]
  })
}

function gh() {
  const {
    dir: e
  } = V(), [t, n] = C.useState(zm), [r, l] = C.useState("karam"), [a, i] = C.useState({
    karam: !0
  });
  return s.jsxs("div", {
    className: "kb-landing",
    dir: e,
    children: [s.jsx(Om, {}), s.jsxs("main", {
      children: [s.jsx(Vm, {
        setActive: l
      }), s.jsx(qm, {
        active: r,
        setActive: l,
        stack: a,
        setStack: i
      }), s.jsx(ka, {
        id: "karam",
        anchor: "karam",
        stack: a,
        setStack: i,
        note: R.chapterKaram
      }), s.jsx(Gm, {
        selection: t,
        setSelection: n
      }), s.jsx(Zm, {
        selection: t,
        setSelection: n
      }), s.jsx(Xm, {}), s.jsx(th, {}), s.jsx(nh, {}), s.jsx(rh, {}), s.jsx(lh, {}), s.jsx(ka, {
        id: "loyalty",
        anchor: "loyalty",
        stack: a,
        setStack: i
      }), s.jsx(ah, {}), s.jsx(ka, {
        id: "attend",
        anchor: "attendance",
        stack: a,
        setStack: i
      }), s.jsx(ch, {}), s.jsx(ph, {}), s.jsx(mh, {}), s.jsx(hh, {
        stack: a,
        setStack: i
      })]
    }), s.jsx(Um, {}), s.jsx(Wm, {})]
  })
}

function yh() {
  return s.jsx(jp, {
    children: s.jsx(gh, {})
  })
}
Ca.createRoot(document.getElementById("root")).render(s.jsx(Oo.StrictMode, {
  children: s.jsx(yh, {})
}));