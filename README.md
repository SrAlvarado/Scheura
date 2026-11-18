# Scheura

Agenda para estudiantes: calendario, tareas, exámenes con temas y progreso, trabajos divididos en pasos, PDFs con información extraída, recordatorios y resumen semanal.

**App:** https://sralvarado.github.io/Scheura/

## Instalar en el móvil (gratis, sin tiendas ni Apple ID)

- **iPhone:** abre el enlace en **Safari** → botón **Compartir** → **Añadir a pantalla de inicio**.
- **Android:** abre el enlace en **Chrome** → menú **⋮** → **Instalar app**.
- **Ordenador:** funciona directamente en el navegador (Chrome/Edge permiten instalarla también).

Funciona sin conexión. Los datos se guardan **solo en tu dispositivo** (IndexedDB); haz copias desde *Ajustes → Exportar copia*.

## Tecnología

PWA con React 18 + TypeScript + Vite, Dexie (IndexedDB), date-fns, pdf.js (lectura de PDFs en el navegador) y vite-plugin-pwa. Se despliega sola en GitHub Pages con cada push a `main` (`.github/workflows/deploy.yml`).

```bash
npm install
npm run dev      # desarrollo en http://localhost:5173/Scheura/
npm run build    # comprueba tipos y genera dist/
```

## Estructura

```
src/
  db/          modelo (types.ts), base de datos (db.ts), operaciones (repo.ts), hooks en vivo (hooks.ts), datos de ejemplo (seed.ts)
  lib/         fechas, colores, etiquetas, progreso, recordatorios, extracción de PDFs
  components/  Shell (barra de pestañas iOS + cabecera de escritorio), componentes de UI e iconos
  features/    pantallas por área: home, calendar, tasks, study, files, summary, settings
  styles/      tokens y estilos globales (estilo «Tinta»)
```

## Limitaciones conocidas (sprint 1)

- **Avisos:** se programan mientras la app está abierta o en segundo plano reciente. Para recibirlos con la app cerrada hace falta Web Push con un servidor (previsto para un sprint posterior, se puede hacer gratis con Cloudflare Workers). En iPhone las notificaciones requieren iOS 16.4+ y tener la app añadida a la pantalla de inicio.
- **PDFs:** la extracción de temas, fechas y conceptos usa heurísticas en el navegador; funciona con PDFs con texto (no escaneados).
- **Sin sincronización** entre dispositivos todavía (exportar/importar copia como alternativa).
