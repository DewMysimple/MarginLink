import { expect, it } from 'vitest';
import { connectorRoute, clearConnectorSegments } from '../src/view/connector-renderer';
import { svgSamples } from './svg-path';
const body = { left: 220, right: 820, top: 0, bottom: 440 };
const obstacles = [120,150,180].map(top => ({ left: 220, right: 820, top, bottom: top + 20 })).concat([{left:220,right:820,top:230,bottom:255}]);
const relations = [
  ['Early Access',300,120,60,158],['dives',600,120,920,48],['Verse',320,150,60,268],
  ['Scene Graph',440,150,60,48],['model-assisted',600,150,920,158],['ship',720,180,920,268]
].map(([key,x,y,cx,cy])=>({key:String(key),source:{left:Number(x),right:Number(x)+40,top:Number(y),bottom:Number(y)+20},card:{x:Number(cx),y:Number(cy),width:84,height:84}}));
it.each(['straight','elbow','curve'] as const)('connects all six visible relations in %s without markers or glyph intersections', style=>{
  for(const lineWidth of [1.5,5.5]) for(const relation of relations){
    const options={body,obstacles,lineWidth,bounds:{left:0,right:1100,top:0,bottom:440},cardObstacles:relations.filter(r=>r!==relation).map(r=>({left:r.card.x,right:r.card.x+84,top:r.card.y,bottom:r.card.y+84}))};
    const route=connectorRoute([relation.source],relation.card,style,undefined,options);
    expect(route,relation.key).toBeDefined();
    expect(clearConnectorSegments(route!.segments,[relation.source],relation.card,options)).toBe(true);
    for(const p of svgSamples(route!.path))expect(obstacles.some(b=>p.x>b.left+.001&&p.x<b.right-.001&&p.y>b.top+.001&&p.y<b.bottom-.001),relation.key).toBe(false);
  }
});
