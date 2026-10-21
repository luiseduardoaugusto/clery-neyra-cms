import * as migration_20261021_143331_initial from './20261021_143331_initial';

export const migrations = [
  {
    up: migration_20261021_143331_initial.up,
    down: migration_20261021_143331_initial.down,
    name: '20261021_143331_initial'
  },
];
