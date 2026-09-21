// Aktiviert den Loader (Import-Map-Ersatz) für die Tests.
import { register } from 'node:module';
register('./loader.mjs', import.meta.url);
