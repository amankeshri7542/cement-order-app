// Words for the film's stages. They are the same at every tier: the film only lays motion over them.
export type Stage = {
  key: string;
  title: string;
  words: string;
  materials: string[];
  night?: boolean;
};
export const stages: Stage[] = [
  {
    key: 'Foundation',
    title: 'It starts below the ground',
    words:
      'Pits are dug, a bed of concrete goes in and the first sariya cages stand up. Nobody will see this work again, so buy it right.',
    materials: ['cement', 'gitti', 'balu', 'sariya'],
  },
  {
    key: 'Columns',
    title: 'Then the steel stands up',
    words:
      'Sariya is tied into cages and the columns are cast around them. They carry everything that comes later.',
    materials: ['sariya', 'cement'],
  },
  {
    key: 'Brickwork',
    title: 'Walls go up, row by row',
    words: 'A mason’s thread keeps every row level. The bamboo goes up with the walls.',
    materials: ['bricks', 'cement', 'balu'],
  },
  {
    key: 'Slab',
    title: 'Slab day',
    words: 'Planks and ballis hold the roof up while it is cast. The whole street hears the mixer.',
    materials: ['cement', 'gitti', 'sariya'],
  },
  {
    key: 'Plaster',
    title: 'Then the house gets its skin',
    words: 'Plaster starts at the top and comes down, floor by floor.',
    materials: ['cement', 'balu'],
  },
  {
    key: 'Home',
    title: 'One evening, the lights come on',
    words:
      'The bamboo comes down and the family moves in. The sariya stays on the roof. In Patna, everyone knows what that means: one more floor, when the time is right.',
    materials: ['sariya', 'cement'],
    night: true,
  },
];
