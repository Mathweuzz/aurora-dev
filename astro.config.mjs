import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';

// ⚠️ Substitua GH_USERNAME abaixo
export default defineConfig({
  site: 'https://Mathweuzz.github.io/aurora-dev/',
  base: '/aurora-dev',
  output: 'static', // SSG para GitHub Pages
  integrations: [tailwind({ config: { applyBaseStyles: true } })]
});