/**
 * Customers demo data: ~58 fictional Indian companies across divisions and hubs, their billing /
 * installation sites (with plausible coordinates), 1–3 contacts each, a contact pool and a few
 * logged interactions. GSTINs are syntactically valid (state code + PAN + check digit) but fictional.
 */
import type { RecordData } from '../metadata/types';
import { addDays, toLocalDateTime } from '../lib/dates';
import { gstinCheckDigit } from '../lib/validators';
import type { SeedContext } from './context';

/** Bump when this module's seed or record shapes change (invalidates stored demo data). */
export const rev = 1;

type Div = 'TX' | 'INK' | 'POD' | 'LBL' | 'PPR' | 'FAB';
type Cat = 'prospect' | 'active' | 'inactive' | 'dealer' | 'distributor';

interface Hub {
  state: string;
  lat: number;
  lng: number;
  pin: string;
  city: string;
  areas: string[];
}
const HUBS: Record<string, Hub> = {
  mumbai: { state: '27', lat: 19.076, lng: 72.8777, pin: '4000', city: 'Mumbai', areas: ['Andheri East', 'Bhiwandi', 'Lower Parel', 'Vasai'] },
  pune: { state: '27', lat: 18.5204, lng: 73.8567, pin: '4110', city: 'Pune', areas: ['Bhosari MIDC', 'Hadapsar', 'Chakan'] },
  surat: { state: '24', lat: 21.1702, lng: 72.8311, pin: '3950', city: 'Surat', areas: ['Sachin GIDC', 'Pandesara GIDC', 'Udhna', 'Ring Road'] },
  ahmedabad: { state: '24', lat: 23.0225, lng: 72.5714, pin: '3800', city: 'Ahmedabad', areas: ['Naroda GIDC', 'Vatva GIDC', 'Narol'] },
  delhi_ncr: { state: '07', lat: 28.6139, lng: 77.209, pin: '1100', city: 'New Delhi', areas: ['Okhla Phase II', 'Naraina', 'Mayapuri'] },
  ludhiana: { state: '03', lat: 30.901, lng: 75.8573, pin: '1410', city: 'Ludhiana', areas: ['Focal Point', 'Industrial Area A', 'Dhandari Kalan'] },
  jaipur: { state: '08', lat: 26.9124, lng: 75.7873, pin: '3020', city: 'Jaipur', areas: ['Sanganer', 'Sitapura', 'VKI Area'] },
  tiruppur: { state: '33', lat: 11.1085, lng: 77.3411, pin: '6416', city: 'Tiruppur', areas: ['Avinashi Road', 'Palladam Road', 'Kangeyam Road'] },
  chennai: { state: '33', lat: 13.0827, lng: 80.2707, pin: '6000', city: 'Chennai', areas: ['Ambattur', 'Guindy', 'Perungudi'] },
  bengaluru: { state: '29', lat: 12.9716, lng: 77.5946, pin: '5600', city: 'Bengaluru', areas: ['Peenya', 'Bommasandra', 'Rajajinagar'] },
  hyderabad: { state: '36', lat: 17.385, lng: 78.4867, pin: '5000', city: 'Hyderabad', areas: ['Balanagar', 'Uppal', 'Kukatpally'] },
  kolkata: { state: '19', lat: 22.5726, lng: 88.3639, pin: '7000', city: 'Kolkata', areas: ['Howrah', 'Topsia', 'Bantala'] },
};

interface CompanySeed {
  name: string;
  hub: keyof typeof HUBS;
  divs: Div[];
  cat: Cat;
  segs: string[];
  industry: string;
  key?: boolean;
  parent?: string;
  dealer?: string;
}

const C = (name: string, hub: keyof typeof HUBS, divs: Div[], cat: Cat, segs: string[], industry = 'textile', extra: Partial<CompanySeed> = {}): CompanySeed => ({ name, hub, divs, cat, segs, industry, ...extra });

const COMPANIES: CompanySeed[] = [
  // Dealers and distributors first so end customers can point at them.
  C('Western India Digital Distributors', 'mumbai', ['TX', 'INK'], 'distributor', ['trader'], 'printing'),
  C('North Star Print Dealers', 'delhi_ncr', ['LBL', 'POD'], 'dealer', ['trader'], 'printing'),
  C('Kongu Textile Machinery Agencies', 'tiruppur', ['TX'], 'dealer', ['trader']),
  C('Deccan Ink Distributors', 'hyderabad', ['INK'], 'distributor', ['trader'], 'printing'),
  C('Bengal Paper Dealers', 'kolkata', ['PPR'], 'dealer', ['trader'], 'printing'),
  // Textile
  C('Shree Ganesh Group', 'surat', ['TX'], 'active', ['mill'], 'textile', { key: true }),
  C('Shree Ganesh Textile Mills', 'surat', ['TX', 'INK'], 'active', ['mill'], 'textile', { parent: 'Shree Ganesh Group', key: true }),
  C('Shree Ganesh Prints (Unit 2)', 'surat', ['TX', 'INK'], 'active', ['job_work'], 'textile', { parent: 'Shree Ganesh Group' }),
  C('Om Sai Digital Prints', 'surat', ['TX', 'INK'], 'active', ['job_work']),
  C('Laxmi Fab Processors', 'surat', ['TX'], 'active', ['mill']),
  C('Tirupati Synthetics', 'surat', ['TX', 'INK'], 'active', ['mill']),
  C('Navkar Prints', 'surat', ['TX'], 'prospect', ['job_work']),
  C('Siddhi Vinayak Processors', 'surat', ['TX'], 'prospect', ['mill']),
  C('Arvind Digital Fabrics', 'ahmedabad', ['TX', 'INK'], 'active', ['mill'], 'textile', { key: true }),
  C('Narol Colour Processors', 'ahmedabad', ['TX'], 'inactive', ['mill']),
  C('Sundaram Knit Processors', 'tiruppur', ['TX', 'INK'], 'active', ['job_work'], 'textile', { dealer: 'Kongu Textile Machinery Agencies' }),
  C('Kongu Textile Printers', 'tiruppur', ['TX'], 'active', ['job_work'], 'textile', { dealer: 'Kongu Textile Machinery Agencies' }),
  C('Erode Textile Digital', 'tiruppur', ['TX'], 'prospect', ['mill']),
  C('Royal Tex Processors', 'ludhiana', ['TX', 'INK'], 'active', ['mill']),
  C('Punjab Woollen Prints', 'ludhiana', ['TX'], 'active', ['mill']),
  C('Amritsar Phulkari Prints', 'ludhiana', ['TX'], 'prospect', ['fashion'], 'home_textile'),
  C('Sanganer Print House', 'jaipur', ['TX', 'INK'], 'active', ['job_work'], 'home_textile'),
  C('Rajasthan Block & Digital', 'jaipur', ['TX'], 'active', ['job_work'], 'home_textile'),
  C('Bhiwandi Power Loom Prints', 'mumbai', ['TX', 'INK'], 'active', ['job_work'], 'textile', { dealer: 'Western India Digital Distributors' }),
  C('Mahavir Fashion Fabrics', 'mumbai', ['TX'], 'active', ['fashion']),
  C('Kolkata Saree Prints', 'kolkata', ['TX'], 'prospect', ['fashion']),
  C('Chennai Silk Digital', 'chennai', ['TX'], 'active', ['fashion']),
  // Fabric
  C('Ruhaani Couture', 'delhi_ncr', ['FAB'], 'active', ['fashion']),
  C('Vastra Studio', 'bengaluru', ['FAB'], 'active', ['fashion']),
  C('Kaavya Boutique', 'hyderabad', ['FAB'], 'prospect', ['fashion']),
  C('Indigo Loom Fashion', 'mumbai', ['FAB', 'TX'], 'active', ['fashion'], 'textile', { key: true }),
  C('Anokhi Rang Designs', 'jaipur', ['FAB'], 'active', ['fashion'], 'home_textile'),
  // Ink
  C('Sai Print Solutions', 'pune', ['INK'], 'active', ['job_work'], 'printing'),
  C('Shubh Labh Digital Bureau', 'mumbai', ['INK'], 'active', ['job_work'], 'printing', { dealer: 'Western India Digital Distributors' }),
  C('Mehta Print Hub', 'ahmedabad', ['INK'], 'active', ['job_work'], 'printing'),
  C('Krishna Sublimation Works', 'surat', ['INK', 'TX'], 'active', ['job_work']),
  C('Colour Craft Studio', 'kolkata', ['INK'], 'prospect', ['commercial_print'], 'signage'),
  C('Hitech Signage Prints', 'hyderabad', ['INK'], 'active', ['commercial_print'], 'signage', { dealer: 'Deccan Ink Distributors' }),
  // POD
  C('PrintKart Express', 'bengaluru', ['POD', 'INK'], 'active', ['commercial_print'], 'printing', { key: true }),
  C('QuickPrint Hub', 'chennai', ['POD'], 'active', ['commercial_print'], 'printing'),
  C('Photo Prints India', 'hyderabad', ['POD'], 'active', ['commercial_print'], 'printing'),
  C('Instant Impressions', 'pune', ['POD'], 'prospect', ['commercial_print'], 'printing'),
  C('Bookwala Print-on-Demand', 'delhi_ncr', ['POD'], 'active', ['commercial_print'], 'printing', { dealer: 'North Star Print Dealers' }),
  C('Print Monk Studio', 'mumbai', ['POD'], 'prospect', ['commercial_print'], 'printing'),
  // Label
  C('Kaveri Label Works', 'bengaluru', ['LBL'], 'active', ['packaging'], 'packaging'),
  C('Sharp Labels', 'hyderabad', ['LBL'], 'active', ['packaging'], 'packaging'),
  C('Pack-N-Tag Converters', 'delhi_ncr', ['LBL'], 'active', ['packaging'], 'packaging', { dealer: 'North Star Print Dealers' }),
  C('Jaipur Label Systems', 'jaipur', ['LBL'], 'prospect', ['packaging'], 'packaging'),
  C('Ganga Flexo Labels', 'kolkata', ['LBL'], 'active', ['packaging'], 'packaging'),
  C('Tirupur Tag & Label', 'tiruppur', ['LBL'], 'active', ['packaging'], 'packaging'),
  // Paper
  C('Mahalaxmi Paper Mart', 'mumbai', ['PPR'], 'active', ['trader'], 'printing'),
  C('Ashoka Paper Traders', 'delhi_ncr', ['PPR'], 'active', ['trader'], 'printing'),
  C('Shree Balaji Paper House', 'ahmedabad', ['PPR'], 'active', ['trader'], 'printing'),
  C('Vardhman Paper Agencies', 'ludhiana', ['PPR'], 'inactive', ['trader'], 'printing'),
  C('Southern Paper Distributors', 'chennai', ['PPR'], 'active', ['trader'], 'printing'),
  C('Sri Venkateswara Papers', 'hyderabad', ['PPR'], 'prospect', ['commercial_print'], 'printing', { dealer: 'Bengal Paper Dealers' }),
  C('Om Sai Digital Prints Pvt Ltd', 'surat', ['INK'], 'prospect', ['job_work'], 'textile'),
];

const FIRST = ['Rajesh', 'Suresh', 'Mahesh', 'Dinesh', 'Ramesh', 'Anil', 'Sunil', 'Vijay', 'Sanjay', 'Ashok', 'Prakash', 'Hitesh', 'Jignesh', 'Ketan', 'Nilesh', 'Gurpreet', 'Harpreet', 'Murugan', 'Senthil', 'Karthik', 'Venkat', 'Srinivas', 'Arjun', 'Neha', 'Priyanka', 'Kavya', 'Meenakshi', 'Pooja', 'Shalini', 'Divya', 'Farida', 'Imtiaz', 'Arindam', 'Sourav', 'Deepa', 'Lakshmi'];
const LAST = ['Shah', 'Patel', 'Mehta', 'Desai', 'Agarwal', 'Jain', 'Gupta', 'Bansal', 'Singh', 'Gill', 'Sandhu', 'Iyer', 'Nair', 'Reddy', 'Rao', 'Naidu', 'Pillai', 'Banerjee', 'Ghosh', 'Mukherjee', 'Khan', 'Qureshi', 'Kulkarni', 'Joshi', 'Sharma', 'Verma'];
const DESIGNATIONS: [string, string][] = [
  ['Managing Director', 'decision_maker'],
  ['Owner', 'decision_maker'],
  ['Managing Partner', 'decision_maker'],
  ['Production Head', 'influencer'],
  ['Technical Manager', 'influencer'],
  ['Purchase Manager', 'influencer'],
  ['Print Operator', 'user'],
  ['Accounts Head', 'finance'],
];

/** Sales owner of a division (falls back to the division head, then the MD). */
const OWNER_BY_DIV: Record<Div, string[]> = {
  TX: ['u_karan', 'u_rohan'],
  INK: ['u_sneha'],
  POD: ['u_priya'],
  LBL: ['u_imran'],
  PPR: ['u_deepak'],
  FAB: ['u_pooja'],
};

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 18);
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function seed(ctx: SeedContext): void {
  const { rnd, today, now } = ctx;
  const customers: RecordData[] = (ctx.records.customers ??= []);
  const addresses: RecordData[] = (ctx.records.addresses ??= []);
  const contacts: RecordData[] = (ctx.records.contacts ??= []);
  const activities: RecordData[] = (ctx.records.activities ??= []);
  const idByName = new Map<string, string>();
  const usedMobiles = new Set<string>();
  const mobile = () => {
    let m = '';
    do m = `${rnd.pick(['98', '97', '99', '96', '93', '88'])}${String(rnd.int(10_000_000, 99_999_999))}`;
    while (usedMobiles.has(m));
    usedMobiles.add(m);
    return m;
  };
  const person = () => `${rnd.pick(FIRST)} ${rnd.pick(LAST)}`;
  const jitter = () => (rnd.next() - 0.5) * 0.12;

  COMPANIES.forEach((co, i) => {
    const hub = HUBS[co.hub];
    const id = ctx.nextId('customers', 'C');
    idByName.set(co.name, id);
    const ownerUser = rnd.pick(OWNER_BY_DIV[co.divs[0]]);
    const pan = `${LETTERS[i % 26]}${LETTERS[(i * 7) % 26]}${LETTERS[(i * 3 + 5) % 26]}C${LETTERS[(i * 11 + 2) % 26]}${String(1000 + ((i * 7919) % 9000)).slice(0, 4)}${LETTERS[(i * 5 + 1) % 26]}`;
    const gst14 = `${hub.state}${pan}1Z`;
    // Prospects often have no GSTIN on file yet; the near-duplicate "Pvt Ltd" record keeps none so it can be merged.
    const hasGst = co.cat !== 'prospect' || rnd.chance(0.3);
    const daysSince = co.cat === 'inactive' ? rnd.int(200, 400) : co.cat === 'prospect' ? rnd.int(5, 60) : rnd.int(1, 45);
    const active = co.cat === 'active' || co.cat === 'dealer' || co.cat === 'distributor';
    const limit = active ? rnd.int(5, 60) * 100_000 : undefined;
    const outstanding = limit ? Math.round(limit * rnd.int(5, 70) / 100) : undefined;
    const overdue = outstanding && rnd.chance(0.3) ? Math.round(outstanding * rnd.int(10, 40) / 100) : outstanding ? 0 : undefined;
    customers.push({
      ...ctx.base(rnd.int(150, 900)),
      id,
      name: co.name,
      legalName: co.parent || co.name.includes('Group') ? `${co.name} Private Limited` : `${co.name}${co.cat === 'dealer' || co.cat === 'distributor' ? ' LLP' : ''}`,
      category: co.cat,
      segmentTags: co.segs,
      industry: co.industry,
      divisionIds: co.divs,
      territoryId: co.hub,
      billingState: hub.state,
      gstin: hasGst ? gst14 + gstinCheckDigit(gst14) : null,
      pan: hasGst ? pan : null,
      website: rnd.chance(0.5) ? `https://www.${slug(co.name)}.example` : null,
      ownerId: ctx.staff(ownerUser),
      parentId: co.parent ? idByName.get(co.parent) ?? null : null,
      dealerId: co.dealer ? idByName.get(co.dealer) ?? null : null,
      keyAccount: !!co.key,
      status: co.cat === 'inactive' ? 'inactive' : 'active',
      creditLimit: limit,
      outstanding,
      overdue,
      erpSyncedAt: limit ? toLocalDateTime(new Date(now.getTime() - rnd.int(1, 72) * 3_600_000)) : null,
      lastActivityAt: toLocalDateTime(new Date(now.getTime() - daysSince * 86_400_000)),
      planObjectives: co.key ? rnd.pick(['Grow ink share to 80% of their installed printers this year', 'Upgrade two older printers to the new 3.2 m model', 'Sign CMC on all machines before warranty ends']) : null,
      planKeyContacts: co.key ? 'MD signs off capex; production head drives trials.' : null,
      planRisks: co.key ? rnd.pick(['Competitor offering lower ink price', 'Cash-flow tight after expansion', 'New production head not yet convinced']) : null,
      planNextReview: co.key ? addDays(today, rnd.int(-10, 40)) : null,
    });

    const area = rnd.pick(hub.areas);
    const pin = `${hub.pin}${String(rnd.int(10, 99))}`;
    addresses.push({ ...ctx.base(300), id: ctx.nextId('addresses', 'ADR'), customerId: id, label: `${hub.city} office`, addressType: 'billing', line1: `${rnd.int(1, 450)}, ${area}`, city: hub.city, state: hub.state, pincode: pin, lat: +(hub.lat + jitter()).toFixed(5), lng: +(hub.lng + jitter()).toFixed(5) });
    if (co.divs.some((d) => ['TX', 'POD', 'LBL', 'FAB'].includes(d)) && co.cat !== 'dealer' && co.cat !== 'distributor') {
      const plant = rnd.pick(hub.areas);
      const geo = rnd.chance(0.9);
      addresses.push({ ...ctx.base(300), id: ctx.nextId('addresses', 'ADR'), customerId: id, label: `${plant} plant`, addressType: 'installation', line1: `Plot ${rnd.int(1, 300)}, ${plant}`, city: hub.city, state: hub.state, pincode: `${hub.pin}${String(rnd.int(10, 99))}`, lat: geo ? +(hub.lat + jitter()).toFixed(5) : null, lng: geo ? +(hub.lng + jitter()).toFixed(5) : null });
    }

    const nContacts = co.name.includes('Group') ? 1 : rnd.int(1, 3);
    for (let k = 0; k < nContacts; k++) {
      const [designation, role] = k === 0 ? DESIGNATIONS[rnd.int(0, 2)] : rnd.pick(DESIGNATIONS.slice(3));
      const name = person();
      const m = mobile();
      contacts.push({
        ...ctx.base(rnd.int(30, 600)),
        id: ctx.nextId('contacts', 'CT'),
        name,
        customerId: id,
        designation,
        department: role === 'finance' ? 'Accounts' : role === 'user' ? 'Production' : 'Management',
        mobile: m,
        whatsapp: rnd.chance(0.8) ? m : null,
        email: rnd.chance(0.75) ? `${name.split(' ')[0].toLowerCase()}@${slug(co.name)}.example` : null,
        buyingRole: role,
        consentWhatsapp: rnd.chance(0.8),
        consentEmail: rnd.chance(0.7),
        consentSms: rnd.chance(0.5),
        ownerId: ctx.staff(ownerUser),
        divisionIds: co.divs,
        source: rnd.pick(['exhibition', 'referral', 'cold_call', 'website', 'dealer']),
        poolStatus: 'contacted',
        city: hub.city,
      });
    }

    // A couple of logged interactions so the 360 timeline and dormancy figures have data.
    if (co.cat !== 'inactive') {
      for (let k = 0; k < rnd.int(1, 3); k++) {
        const back = k === 0 ? daysSince : daysSince + rnd.int(5, 40);
        const at = toLocalDateTime(new Date(now.getTime() - back * 86_400_000 - rnd.int(1, 8) * 3_600_000));
        activities.push({
          ...ctx.base(back, 'system'),
          id: ctx.nextId('activities', 'ACT'),
          subject: rnd.pick(['Courtesy call', 'Discussed ink consumption', 'Visited plant with engineer', 'Shared new product catalogue', 'Payment follow-up', 'Reviewed print quality samples']),
          activityType: rnd.pick(['call', 'visit', 'meeting', 'whatsapp', 'email']),
          at,
          byId: ctx.staff(ownerUser),
          parentResource: 'customers',
          parentId: id,
          parentLabel: `${id} · ${co.name}`,
          customerId: id,
          nextFollowUpAt: k === 0 && rnd.chance(0.4) ? addDays(today, rnd.int(1, 14)) : null,
          notes: '',
        });
      }
    }
  });

  // Contact pool: prospects met at exhibitions, from marketplaces or cold calls — no company yet.
  const poolCities = ['Surat', 'Tiruppur', 'Ludhiana', 'Jaipur', 'Pune', 'Bengaluru', 'Kolkata', 'Ahmedabad', 'Hyderabad', 'New Delhi'];
  for (let k = 0; k < 25; k++) {
    const name = person();
    const user = rnd.pick(['u_karan', 'u_sneha', 'u_priya', 'u_imran', 'u_deepak', 'u_pooja', 'u_rohan']);
    const div = (Object.entries(OWNER_BY_DIV).find(([, us]) => us.includes(user))?.[0] ?? 'TX') as Div;
    const m = mobile();
    contacts.push({
      ...ctx.base(rnd.int(2, 90)),
      id: ctx.nextId('contacts', 'CT'),
      name,
      customerId: null,
      designation: rnd.pick(['Owner', 'Proprietor', 'Production Manager', 'Partner']),
      mobile: m,
      whatsapp: m,
      email: rnd.chance(0.5) ? `${name.split(' ')[0].toLowerCase()}.${k}@example.com` : null,
      buyingRole: 'decision_maker',
      consentWhatsapp: rnd.chance(0.6),
      consentEmail: rnd.chance(0.4),
      consentSms: false,
      ownerId: ctx.staff(user),
      divisionIds: [div],
      source: rnd.pick(['exhibition', 'exhibition', 'indiamart', 'cold_call', 'walk_in', 'social']),
      poolStatus: rnd.chance(0.35) ? 'contacted' : 'new',
      city: rnd.pick(poolCities),
      notes: rnd.chance(0.4) ? 'Met at Gartex stall — interested in sublimation printing.' : '',
    });
  }
}
