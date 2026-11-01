import type { LucideIcon } from 'lucide-react';
import { Armchair, Bed, Coffee, Droplets, Flame, Lamp, Layers, Leaf, Snowflake, TreePine, Utensils, WavesHorizontal } from 'lucide-react';

export const CATEGORIES = ['Textiles', 'Kitchen', 'Sauna', 'Lighting', 'Living'] as const;
export type Category = (typeof CATEGORIES)[number];

export interface Product {
  id: string;
  name: string;
  tagline: string;
  category: Category;
  /** EUR, VAT included. */
  price: number;
  rating: number;
  reviewCount: number;
  description: string;
  details: string[];
  tags: string[];
  featured: boolean;
  icon: LucideIcon;
  /** Tailwind gradient classes for the product visual (full strings so Tailwind picks them up). */
  swatch: string;
  /** Icon colour on top of the swatch. */
  ink: string;
}

export const PRODUCTS: Product[] = [
  {
    id: 'kaamos-wool-throw', name: 'Kaamos Wool Throw', tagline: 'Lambswool, woven in Lapland', category: 'Textiles',
    price: 129, rating: 4.8, reviewCount: 214, featured: true, icon: Layers,
    swatch: 'from-stone-200 via-stone-100 to-amber-100', ink: 'text-stone-600',
    description: 'A generous throw in undyed Finnish lambswool, woven on traditional looms for the long polar night. Soft enough for bare skin, warm enough for the porch.',
    details: ['130 × 180 cm', '100% Finnish lambswool', 'Hand wash cold, dry flat'],
    tags: ['wool', 'winter', 'living-room', 'handmade'],
  },
  {
    id: 'kuksa-birch-cup', name: 'Kuksa Birch Cup', tagline: 'Carved from a single burl', category: 'Kitchen',
    price: 49, rating: 4.9, reviewCount: 388, featured: true, icon: TreePine,
    swatch: 'from-amber-200 via-amber-100 to-orange-50', ink: 'text-amber-800',
    description: 'The traditional Sámi drinking cup, hand-carved from curly birch burl and finished with food-safe oil. Every grain pattern is one of a kind.',
    details: ['Approx. 200 ml', 'Curly birch burl, linseed oil', 'Rinse with warm water, no soap'],
    tags: ['birch', 'handmade', 'outdoor', 'gift'],
  },
  {
    id: 'aamu-linen-bedding', name: 'Aamu Linen Bedding Set', tagline: 'Stonewashed European flax', category: 'Textiles',
    price: 159, rating: 4.7, reviewCount: 167, featured: true, icon: Bed,
    swatch: 'from-sky-100 via-slate-50 to-stone-100', ink: 'text-slate-500',
    description: 'Duvet cover and two pillowcases in heavyweight stonewashed linen. Breathable in summer, cosy in winter, and softer with every wash.',
    details: ['Duvet 150 × 210 cm, 2 × pillow 50 × 60 cm', '100% European flax linen', 'Machine wash 40 °C'],
    tags: ['linen', 'bedroom', 'sleep'],
  },
  {
    id: 'routa-stoneware-mugs', name: 'Routa Stoneware Mugs', tagline: 'Set of two, frost glaze', category: 'Kitchen',
    price: 38, rating: 4.6, reviewCount: 302, featured: false, icon: Coffee,
    swatch: 'from-slate-200 via-stone-100 to-white', ink: 'text-slate-600',
    description: 'Wheel-thrown stoneware mugs with a speckled frost glaze that pools at the rim. Sized for a proper Nordic coffee break.',
    details: ['2 × 300 ml', 'Glazed stoneware', 'Dishwasher and microwave safe'],
    tags: ['ceramic', 'coffee', 'gift', 'new'],
  },
  {
    id: 'loyly-sauna-set', name: 'Löyly Sauna Set', tagline: 'Bucket, ladle & thermometer', category: 'Sauna',
    price: 89, rating: 4.8, reviewCount: 143, featured: true, icon: Droplets,
    swatch: 'from-orange-200 via-amber-100 to-stone-100', ink: 'text-orange-800',
    description: 'A heat-treated aspen bucket with a copper-lined interior, matching long-handled ladle and a wooden thermometer. Everything for the perfect löyly.',
    details: ['4 l bucket, 40 cm ladle', 'Thermo-aspen and copper', 'Made in Ostrobothnia'],
    tags: ['sauna', 'wood', 'gift'],
  },
  {
    id: 'saunaliina-towel', name: 'Saunaliina Linen Towel', tagline: 'Waffle-weave, quick drying', category: 'Sauna',
    price: 42, rating: 4.5, reviewCount: 96, featured: false, icon: WavesHorizontal,
    swatch: 'from-emerald-100 via-stone-100 to-stone-50', ink: 'text-emerald-800',
    description: 'A light waffle-weave linen and cotton towel that dries fast between rounds. Doubles as a seat cover on the lauteet.',
    details: ['90 × 150 cm', '55% linen, 45% cotton', 'Machine wash 60 °C'],
    tags: ['sauna', 'linen', 'bath', 'new'],
  },
  {
    id: 'valo-beeswax-candles', name: 'Valo Beeswax Candles', tagline: 'Hand-dipped, set of six', category: 'Lighting',
    price: 24, rating: 4.7, reviewCount: 451, featured: false, icon: Flame,
    swatch: 'from-yellow-100 via-amber-50 to-stone-100', ink: 'text-amber-700',
    description: 'Pure beeswax taper candles hand-dipped in small batches. A slow, clean burn with a faint scent of honey for dark afternoons.',
    details: ['6 × 25 cm tapers', 'Approx. 8 h burn time each', '100% Finnish beeswax'],
    tags: ['candlelight', 'winter', 'gift'],
  },
  {
    id: 'kuu-pendant-lamp', name: 'Kuu Pendant Lamp', tagline: 'Pleated paper, oak crown', category: 'Lighting',
    price: 219, rating: 4.6, reviewCount: 58, featured: true, icon: Lamp,
    swatch: 'from-stone-100 via-amber-50 to-yellow-50', ink: 'text-stone-500',
    description: 'A pleated paper shade around a solid oak crown that diffuses light like a winter moon. Designed in Helsinki, assembled by hand.',
    details: ['Ø 45 cm, 3 m textile cord', 'E27, max 60 W (LED recommended)', 'Oak and archival paper'],
    tags: ['candlelight', 'living-room', 'design', 'new'],
  },
  {
    id: 'tunturi-sheepskin-pad', name: 'Tunturi Sheepskin Seat Pad', tagline: 'Long-pile, naturally tanned', category: 'Living',
    price: 69, rating: 4.4, reviewCount: 121, featured: false, icon: Armchair,
    swatch: 'from-stone-200 via-neutral-100 to-white', ink: 'text-neutral-500',
    description: 'A round long-pile sheepskin that softens wooden chairs, benches and window seats. Ethically sourced and tanned without chrome.',
    details: ['Ø 37 cm', 'Natural sheepskin, chrome-free tan', 'Shake out and air regularly'],
    tags: ['wool', 'winter', 'living-room'],
  },
  {
    id: 'kataja-cutting-board', name: 'Kataja Juniper Board', tagline: 'Fragrant, end-grain juniper', category: 'Kitchen',
    price: 55, rating: 4.7, reviewCount: 88, featured: false, icon: Utensils,
    swatch: 'from-lime-100 via-stone-100 to-amber-50', ink: 'text-lime-800',
    description: 'A serving and cutting board in aromatic juniper. Releases a gentle forest scent when warm bread meets the wood.',
    details: ['40 × 20 × 2.5 cm', 'Finnish juniper, natural oil', 'Hand wash, oil monthly'],
    tags: ['wood', 'handmade', 'gift'],
  },
  {
    id: 'metsa-room-mist', name: 'Metsä Room Mist', tagline: 'Pine, moss & cold air', category: 'Living',
    price: 19, rating: 4.3, reviewCount: 203, featured: false, icon: Leaf,
    swatch: 'from-emerald-200 via-emerald-50 to-stone-100', ink: 'text-emerald-700',
    description: 'A botanical room and linen mist that smells like a walk in a spruce forest after the first frost. Made with plant-based alcohol.',
    details: ['100 ml glass bottle', 'Natural essential oils', 'Vegan, no synthetic fragrance'],
    tags: ['sauna', 'scent', 'gift', 'new'],
  },
  {
    id: 'huopa-wool-slippers', name: 'Huopa Felted Slippers', tagline: 'Boiled wool, leather sole', category: 'Textiles',
    price: 59, rating: 4.5, reviewCount: 176, featured: false, icon: Snowflake,
    swatch: 'from-rose-100 via-stone-100 to-stone-50', ink: 'text-rose-800',
    description: 'Seamless felted wool slippers with a suede sole. Warm on cold floorboards and naturally temperature regulating.',
    details: ['EU sizes 36–46', 'Felted merino wool, suede', 'Shape retains with wear'],
    tags: ['wool', 'winter', 'handmade'],
  },
];

const BY_ID = new Map(PRODUCTS.map((p) => [p.id, p]));
export const findProduct = (id: string): Product | undefined => BY_ID.get(id);
