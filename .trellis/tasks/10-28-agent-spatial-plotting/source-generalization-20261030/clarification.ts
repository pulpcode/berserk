import assert from 'node:assert/strict';
import type {Axis,Source,Oracle} from './data.js';
export interface ScopeState {known:Partial<Record<Axis,Source>>;answered:Axis[];redundant:number}
export interface Selection {axes:Axis[];generic?:boolean}
export function initialScope(o:Oracle):ScopeState {return {known:Object.fromEntries(Object.entries(o.declared_scope).filter(([,v])=>v==='draft'||v==='source')),answered:[],redundant:0};}
/** The reviewer supplies semantics. No keyword/question-mark classifier is used. */
export function reply(o:Oracle,state:ScopeState,selection:Selection){
 const axes=selection.generic?(['candidate','reference'] as Axis[]).filter(a=>!state.known[a]):selection.axes;
 const selected=axes.length?axes:(selection.generic?['candidate','reference'] as Axis[]:[]);
 assert.ok(selected.length&&selected.length<=2&&new Set(selected).size===selected.length&&selected.every(a=>a==='candidate'||a==='reference'),'Invalid axes');
 const next=structuredClone(state),unknown=selected.filter(a=>!next.known[a]);
 if(!unknown.length){assert.equal(next.redundant,0,'Repeated clarification without progress');next.redundant++;}
 for(const a of unknown){assert.ok(!next.answered.includes(a));next.known[a]=o.preferred_scope_if_asked[a];next.answered.push(a);}
 const text=selected.map(a=>o.clarification.replies_by_axis[a]).join('');
 return {text,state:next,axes:selected,coupledSourceQuestion:Boolean(selection.generic&&unknown.length===2),redundant:unknown.length===0};
}
