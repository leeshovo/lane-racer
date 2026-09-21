// Node-Loader: bildet die Import-Map des Browsers nach.
//  - "three" kommt aus node_modules (oder aus THREE_MODULE, falls gesetzt)
//  - cars.js wird durch eine Attrappe ersetzt (die Modelle sind für die Logik egal)
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const THREE_URL = process.env.THREE_MODULE
  ? pathToFileURL(process.env.THREE_MODULE).href
  : pathToFileURL(path.join(root, 'node_modules', 'three', 'build', 'three.module.js')).href;
const CARS_STUB = pathToFileURL(path.join(here, 'cars-stub.mjs')).href;

export async function resolve(specifier, context, next) {
  if (specifier === 'three') return { url: THREE_URL, shortCircuit: true };
  if (specifier === './cars.js') return { url: CARS_STUB, shortCircuit: true };
  return next(specifier, context);
}
