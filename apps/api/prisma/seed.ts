import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
async function main() {
  if (process.env.NODE_ENV === 'production')
    throw new Error('Example inventory cannot be seeded in production.');
  try {
    const categories = [
      { name: 'Cement', slug: 'cement' },
      { name: 'Steel', slug: 'steel' },
      { name: 'Sand', slug: 'sand' },
      { name: 'Bricks', slug: 'bricks' },
    ];
    for (const c of categories)
      await db.category.upsert({
        where: { slug: c.slug },
        create: { id: c.slug, ...c },
        update: {},
      });
    const products = [
      {
        id: 'ultratech-ppc',
        name: 'UltraTech Super',
        brand: 'UltraTech',
        categoryId: 'cement',
        type: 'PPC Cement',
        grade: 'PPC',
        unit: '50 kg bag',
        pricePaise: 41000,
        stock: 850,
        description:
          'Portland pozzolana cement for durable everyday construction. Price shown is per 50 kg bag.',
        recommendedUse: 'Brickwork, plastering and residential construction.',
      },
      {
        id: 'acc-gold',
        name: 'ACC Gold Water Shield',
        brand: 'ACC',
        categoryId: 'cement',
        type: 'Water-resistant cement',
        grade: 'PPC',
        unit: '50 kg bag',
        pricePaise: 44500,
        stock: 320,
        description:
          'Premium water-resistant cement for strong construction. Confirm grade suitability with your engineer.',
        recommendedUse: 'Foundations, external walls and moisture-prone areas.',
      },
      {
        id: 'dalmia-dsp',
        name: 'Dalmia DSP',
        brand: 'Dalmia',
        categoryId: 'cement',
        type: 'Composite cement',
        grade: 'CC',
        unit: '50 kg bag',
        pricePaise: 39500,
        stock: 480,
        description: 'Cement designed for day-to-day building work, supplied in sealed 50 kg bags.',
        recommendedUse: 'Residential structures and general construction.',
      },
      {
        id: 'shree-roofon',
        name: 'Shree Roofon',
        brand: 'Shree',
        categoryId: 'cement',
        type: 'OPC Cement',
        grade: '53 grade',
        unit: '50 kg bag',
        pricePaise: 42000,
        stock: 200,
        description:
          '53-grade ordinary Portland cement. Check your structural specifications before ordering.',
        recommendedUse: 'RCC work, slabs, beams and columns.',
      },
      {
        id: 'tata-tiscon',
        name: 'Tata Tiscon 550SD',
        brand: 'Tata',
        categoryId: 'steel',
        type: 'TMT reinforcement bar',
        grade: 'Fe 550D',
        unit: 'kg · 12 mm',
        pricePaise: 6800,
        stock: 5000,
        description:
          '12 mm TMT reinforcement steel, sold by weight. Cut lengths and unloading can be discussed with the store.',
        recommendedUse: 'Reinforcement for RCC beams, columns and slabs.',
      },
      {
        id: 'river-sand',
        name: 'Construction sand',
        brand: 'Local supply',
        categoryId: 'sand',
        type: 'Washed sand',
        grade: 'Construction',
        unit: '100 cu ft',
        pricePaise: 680000,
        stock: 18,
        description:
          'Washed construction sand. Final delivery access and unloading location are confirmed by the store.',
        recommendedUse: 'Mortar and concrete mixes as specified by your engineer.',
      },
      {
        id: 'red-bricks',
        name: 'First-class red bricks',
        brand: 'Local kiln',
        categoryId: 'bricks',
        type: 'Burnt clay brick',
        grade: 'First class',
        unit: '1,000 bricks',
        pricePaise: 850000,
        stock: 30,
        description: 'Kiln-fired red bricks for masonry work. Sold in lots of 1,000.',
        recommendedUse: 'Load-bearing and partition masonry as specified.',
      },
    ];
    for (const p of products)
      await db.product.upsert({ where: { id: p.id }, create: { ...p, images: [] }, update: {} });
    await db.storeSettings.upsert({
      where: { id: 'store' },
      create: {
        id: 'store',
        phone: '+919297513707',
        deliveryFeePaise: 50000,
        freeDeliveryAbovePaise: 5000000,
      },
      update: {},
    });
    console.log(
      'Example products added. Review all prices and delivery fees before accepting real orders. No admin account was automatically created.',
    );
  } finally {
    await db.$disconnect();
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
