import { describe, expect, it } from 'vitest';
import { connectorRoute, clearConnectorSegments } from '../src/view/connector-renderer';
import { svgSamples } from './svg-path';
const source = { left: 420, right: 492, top: 120, bottom: 140 };
const body = { left: 180, right: 820, top: 0, bottom: 700 };
const angle = (a: {dx:number;dy:number}, b: {dx:number;dy:number}) => Math.acos(Math.min(1,Math.max(-1,(a.dx*b.dx+a.dy*b.dy)/(Math.hypot(a.dx,a.dy)*Math.hypot(b.dx,b.dy)))));
describe('tangent-continuous curve rendering', () => {
  it.each([48, 856])('uses a substantial smooth transition for an unobstructed diagonal at x=%s', x => {
    const card = { x, y: 350, width: 84, height: 84 }, route = connectorRoute([source], card, 'curve', undefined, { body, lineWidth: 2 })!;
    expect(route).toBeDefined();
    const samples = svgSamples(route.path), curved = samples.filter(p => p.command > 1 && p.command < samples.at(-1)!.command);
    let turningLength = 0;
    for(let i=1;i<curved.length;i++) if(angle(curved[i-1],curved[i])>0.000001) turningLength+=Math.hypot(curved[i].x-curved[i-1].x,curved[i].y-curved[i-1].y);
    expect(turningLength).toBeGreaterThan(60);
    expect(Math.abs(samples[1].dx)).toBeLessThan(.001);
    const last=samples.at(-1)!;
    expect(route.choice.target==='left'||route.choice.target==='right' ? Math.abs(last.dy) : Math.abs(last.dx)).toBeLessThan(.001);
    for(let i=2;i<samples.length;i++) expect(angle(samples[i-1],samples[i])).toBeLessThan(.03);
    expect(clearConnectorSegments(route.segments,[source],card,{body,lineWidth:2})).toBe(true);
  });
  it('joins a requested shared corridor tangentially and leaves a true straight trunk', () => {
    const card={x:856,y:400,width:84,height:84}, options={body,lineWidth:2,corridorX:838,preferCorridor:true};
    const route=connectorRoute([source],card,'curve',undefined,options)!;
    expect(route).toBeDefined();
    const trunk=route.segments.filter(s=>!s.control&&s.from.x===838&&s.to.x===838&&Math.abs(s.from.y-s.to.y)>24);
    expect(trunk.length).toBeGreaterThan(0);
    const samples=svgSamples(route.path);
    for(let i=2;i<samples.length;i++) expect(angle(samples[i-1],samples[i])).toBeLessThan(.035);
  });
  it('keeps a naturally collinear connection straight', () => {
    const route=connectorRoute([{left:100,right:140,top:100,bottom:116}],{x:110,y:140,width:20,height:20},'curve')!;
    expect(svgSamples(route.path).every(p=>Math.abs(p.x-120)<.001)).toBe(true);
    expect(route.segments.some(s=>s.control)).toBe(false);
  });
  it('safely adjusts a smooth candidate around an inline obstacle', () => {
    const card={x:856,y:350,width:84,height:84}, obstacle={left:620,right:700,top:200,bottom:290};
    const options={body,obstacles:[obstacle],lineWidth:5},route=connectorRoute([source],card,'curve',undefined,options)!;
    expect(route).toBeDefined();expect(clearConnectorSegments(route.segments,[source],card,options)).toBe(true);
    expect(svgSamples(route.path).some(p=>p.x>obstacle.left-4&&p.x<obstacle.right+4&&p.y>obstacle.top-4&&p.y<obstacle.bottom+4)).toBe(false);
  });
});
