import raw from '@/data/products.json?raw';
import taxonomy from '@/data/departments.json';
export type Product={id:string;name:string;brand:string;department:string;category:string;priceGHS:number|null;sourcePrice?:number;sourceCurrency?:string;image:string;images?:string[];sourceUrl:string;description:string;priceType?:string;sourceName?:string;specs?:Record<string,string>};
export const products=JSON.parse(raw) as Product[];
export const departments=taxonomy as {id:string;name:string;subtitle?:string;categories:string[]}[];
export const byId=new Map(products.map(p=>[p.id,p]));

// Broad departments should show recognisable essentials, rather than whichever
// accessory happened to be imported first. These preferences only select images.
const departmentImageCategories:Record<string,string[]>={
 strength:['Dumbbells','Dumbbells & Kettlebells','Strength Machines'],
 cardio:['Treadmills','Exercise Bikes'],
 protein:['Whey Protein','Plant Protein'],
 womens:['Leggings & Tights','Sports Bras','T-Shirts & Tops'],
 mens:['T-Shirts & Tops','Shorts','Joggers & Trousers'],
 footwear:['Running Shoes','Training Shoes'],
 recovery:['Massage Guns','Foam Rollers'],
 functional:['Resistance Bands','Bodyweight Trainers'],
 supplements:['Creatine','Pre-Workout'],
 vitamins:['Vitamins','Multivitamins'],
 nutrition:['Protein Snacks','Bars & Foods'],
 hydration:['Water Bottles','Bottles & Shakers'],
 yoga:['Mats & Props','Pilates Equipment'],
 wearables:['Smartwatches & Trackers','Watches & Fitness Tech'],
 outdoor:['Backpacks & Bags','Camping Equipment'],
 cycling:['Bikes','Helmets & Safety'],
 swimming:['Goggles & Swim Accessories','Swimwear'],
 'team-sports':['Balls','Goals & Training Equipment'],
 'racket-sports':['Rackets & Bats','Tables & Nets'],
 combat:['Gloves & Protective Gear','Bags & Training Equipment'],
 'gym-facilities':['Storage','Flooring'],
 accessibility:['Mobility Aids','Adaptive Exercise & Sport'],
};

const categoryImageNames:Record<string,RegExp>={
 'Strength Machines':/\b(machine|leg (?:press|curl|extension|sled)|hack squat|glute ham developer)\b/i,
 'Activewear':/\b(t[ -]?shirts?|tops?|shorts?|leggings?|joggers?|trousers?|pants?|hoodies?|sweatshirts?|jackets?|bottoms?)\b/i,
 'T-Shirts & Tops':/\b(t[ -]?shirts?|tees?|tops?|polo shirts?)\b/i,
 'Shorts':/\bshorts?\b/i,
 'Hoodies & Sweatshirts':/\b(hoodies?|hooded|sweatshirts?)\b/i,
 'Tanks & Crop Tops':/\b(tank|crop|vest|stringer)\b/i,
 'Hats & Headwear':/\b(caps?|hats?|sunhats?|headbands?|headwear)\b/i,
 'Massage Guns':/\b(massage gun|theragun|hypervolt|percussion massager)\b/i,
 'Water Bottles':/\b(bottle|jug|flask)\b/i,
 'Smartwatches & Trackers':/\b(watch|smartwatch|tracker|amazfit|garmin)\b/i,
 'Goggles & Swim Accessories':/\b(goggles?|swim(?:ming)? masks?)\b/i,
 'Balls':/\b(ball|basketball|football|volleyball|handball|rugby)\b/i,
 'Storage':/\b(storage|rack|stand|tree|organiser|organizer)\b/i,
 'Mobility Aids':/\b(walker|walking|rollator|wheelchair|crutch|cane|mobility)\b/i,
};
const categoryImageExclusions:Record<string,RegExp>={
 'Strength Machines':/\b(attachment|strap|mount|dock|case|rope|replacement|spare|adapter|accessory|accessories|kit)\b|\bbelt\b(?!\s+squat)/i,
 'Activewear':/\b(gloves?|pads?|socks?|boxers?|briefs?)\b/i,
 'Shorts':/\b(boxers?|briefs?|underwear|t[ -]?shirts?|tops?)\b/i,
 'Hoodies & Sweatshirts':/\b(t[ -]?shirts?|tank tops?)\b/i,
 'Massage Guns':/\b(attachment|head|case|charger|stand|holder|replacement)\b/i,
 'Treadmills':/\b(replacement|belt|lubricant|cover|mat|accessory|accessories)\b/i,
 'Bikes':/\b(tyre|tire|tube|helmet|pump|stand|rack|saddle|pedal|brake|lock|replacement)\b/i,
 'Smartwatches & Trackers':/\b(strap|band|charger|cable|protector|replacement)\b/i,
 'Goggles & Swim Accessories':/\b(re-?activator|spray|cleaner|case|replacement|strap|seal)\b/i,
};
const genericImageWords=new Set(['and','accessory','equipment','training','sport','other','care','performance','health','functional']);
function imageWords(value:string){return value.toLowerCase().replace(/t[ -]?shirts?/g,'tshirt').match(/[a-z]+/g)?.map(word=>word.length>3?word.replace(/ies$/,'y').replace(/(?<!s)s$/,''):word)||[]}
function representativeProduct(items:Product[],category:string):Product|undefined{
 const words=imageWords(category).filter(word=>!genericImageWords.has(word));
 let selected:Product|undefined,bestScore=-Infinity;
 for(const product of items){
  if(!product.image)continue;
  const nameWords=new Set(imageWords(product.name));
  const nameRule=categoryImageNames[category];
  let score=nameRule?(nameRule.test(product.name)?100:0):words.reduce((total,word)=>total+(nameWords.has(word)?20:0),0);
  if(categoryImageExclusions[category]?.test(product.name))score-=200;
  if((product.department==='mens'||product.department==='womens')&&/\b(kids?|child(?:ren)?|boys?|girls?|junior)\b/i.test(product.name))score-=50;
  if(score>bestScore){selected=product;bestScore=score}
 }
 return selected;
}
function departmentImage(items:Product[],department:string){
 for(const category of departmentImageCategories[department]||[]){
  const representative=representativeProduct(items.filter(product=>product.category===category),category);
  if(representative)return representative.image;
 }
 return representativeProduct(items,'')?.image;
}
export const summaries=departments.map(d=>{const items=products.filter(p=>p.department===d.id);return{...d,count:items.length,categories:d.categories.map(c=>{const matches=items.filter(p=>p.category===c);return{name:c,count:matches.length,image:representativeProduct(matches,c)?.image}}),image:departmentImage(items,d.id)}});
export function search(params:URLSearchParams){let data=products;const q=(params.get('q')||'').toLowerCase();if(q)data=data.filter(p=>`${p.name} ${p.brand} ${p.category} ${p.department}`.toLowerCase().includes(q));const dept=params.get('department'),cat=params.get('category'),brand=params.get('brand'),ids=params.get('ids');if(dept)data=data.filter(p=>p.department===dept);if(cat)data=data.filter(p=>p.category===cat);if(brand)data=data.filter(p=>p.brand===brand);if(ids){const selected=new Set(ids.split(','));data=data.filter(p=>selected.has(p.id))}const max=Number(params.get('max')||0);if(max>0)data=data.filter(p=>p.priceGHS&&p.priceGHS<=max);const sort=params.get('sort');if(sort==='price-asc')data=[...data].sort((a,b)=>(a.priceGHS||Infinity)-(b.priceGHS||Infinity));if(sort==='price-desc')data=[...data].sort((a,b)=>(b.priceGHS||0)-(a.priceGHS||0));if(sort==='name')data=[...data].sort((a,b)=>a.name.localeCompare(b.name));const total=data.length;const brands=[...new Set(data.map(p=>p.brand))].sort();const page=Math.max(1,Number(params.get('page')||1)),limit=Math.min(100,Math.max(1,Number(params.get('limit')||24)));return {products:data.slice((page-1)*limit,page*limit),total,page,pages:Math.ceil(total/limit),brands};}
