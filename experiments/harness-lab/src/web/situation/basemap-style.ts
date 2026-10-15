import type { ExpressionSpecification, LayerSpecification } from 'maplibre-gl';

export const BUSINESS_ANCHOR = 'business:anchor';
const name: ExpressionSpecification = ['coalesce',['get','name:zh'],['get','name'],['get','name:latin'],['get','ref'],''];
const roadFilter: ExpressionSpecification = ['match',['get','class'],['motorway','trunk','primary','secondary','tertiary','minor','service','track','path'],true,false];
const roadWidth = (casing=0, scale=1): ExpressionSpecification => ['interpolate',['linear'],['zoom'],5,['match',['get','class'],['motorway','trunk'],0.8*scale+casing,0.2*scale+casing],12,['match',['get','class'],['motorway','trunk'],3*scale+casing,['primary','secondary'],2*scale+casing,1*scale+casing],16,['match',['get','class'],['motorway','trunk'],10*scale+casing,['primary','secondary'],7*scale+casing,4*scale+casing]];
/** Owned OpenMapTiles layers; never import arbitrary style IDs into the business map. */
export function roadLayers(source: string, hybrid: boolean): LayerSpecification[] {
  const prefix = `${source}:${hybrid?'hybrid':'road'}`;
  const color = hybrid?'#f7f6ed':'#687078', halo = hybrid?'#25333c':'#ffffff';
  const filter: ExpressionSpecification = hybrid ? ['match',['get','class'],['motorway','trunk','primary','secondary','tertiary'],true,false] : roadFilter;
  const layers: LayerSpecification[] = hybrid ? [] : [
    {id:`${prefix}:background`,type:'background',paint:{'background-color':'#f1f2f1'}},
    {id:`${prefix}:landuse`,type:'fill',source,'source-layer':'landuse',paint:{'fill-color':'#e9ebe8','fill-opacity':0.5}},
    {id:`${prefix}:park`,type:'fill',source,'source-layer':'park',paint:{'fill-color':'#e3e9e1','fill-opacity':0.6}},
    {id:`${prefix}:water`,type:'fill',source,'source-layer':'water',paint:{'fill-color':'#cbdce3'}},
    {id:`${prefix}:waterway`,type:'line',source,'source-layer':'waterway',paint:{'line-color':'#c3d6df','line-width':['interpolate',['linear'],['zoom'],8,0.5,14,2]}},
    {id:`${prefix}:building`,type:'fill',source,'source-layer':'building',minzoom:13,paint:{'fill-color':'#dedfdd','fill-outline-color':'#d3d5d2','fill-opacity':0.75}},
  ];
  layers.push(
    {id:`${prefix}:road-casing`,type:'line',source,'source-layer':'transportation',filter,layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':hybrid?'#263842':'#d1d4d3','line-opacity':hybrid?0.65:1,'line-width':roadWidth(1,hybrid?0.45:1)}},
    {id:`${prefix}:road-lines`,type:'line',source,'source-layer':'transportation',filter,layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':hybrid?'#f2edda':['match',['get','class'],['motorway','trunk'],'#f1e9d2','#ffffff'],'line-width':roadWidth(0,hybrid?0.45:1),'line-opacity':hybrid?0.7:1}},
    {id:`${prefix}:road-label`,type:'symbol',source,'source-layer':'transportation_name',minzoom:hybrid?13:12,...(hybrid?{filter}:{}),layout:{'symbol-placement':'line','text-field':name,'text-font':['Noto Sans Regular'],'text-size':11,'symbol-spacing':350},paint:{'text-color':color,'text-halo-color':halo,'text-halo-width':1.5}},
    {id:`${prefix}:place-label`,type:'symbol',source,'source-layer':'place',minzoom:2,filter:['match',['get','class'],['continent','country','state','city','town','village','suburb','neighbourhood'],true,false],layout:{'text-field':name,'text-font':['Noto Sans Regular'],'text-size':['interpolate',['linear'],['zoom'],3,11,12,14],'text-max-width':9,'text-padding':hybrid?24:12,'text-allow-overlap':false},paint:{'text-color':color,'text-halo-color':halo,'text-halo-width':1.5}},
  );
  return layers;
}
