# Scheura

Agenda para estudiantes: calendario, tareas, exámenes con temas y progreso, trabajos divididos en pasos, PDFs con información extraída, recordatorios y resumen semanal.

**App:** https://sralvarado.github.io/Scheura/

## Instalar en el móvil (gratis, sin tiendas ni Apple ID)

- **iPhone:** abre el enlace en **Safari** → botón **Compartir** → **Añadir a pantalla de inicio**.
- **Android:** abre el enlace en **Chrome** → menú **⋮** → **Instalar app**.
- **Ordenador:** funciona directamente en el navegador (Chrome/Edge permiten instalarla también).

Funciona sin conexión. Los datos se guardan **solo en tu dispositivo** (IndexedDB); haz copias desde *Ajustes → Exportar copia*.

## Sincronizar entre dispositivos (sprint 2)

*Ajustes → Sincronizar dispositivos*:

- **Usuario y contraseña**: elige ambos la primera vez y entra con los mismos en tus otros dispositivos. Cada persona tiene su propio espacio.
- **O con código**: crea un código (o escanea su QR) y escríbelo en el otro dispositivo.

Cifrado de extremo a extremo: la clave se deriva en el dispositivo (PBKDF2) y el servidor solo guarda datos cifrados; nunca recibe la contraseña. Por eso **una contraseña olvidada no se puede recuperar** (los datos siguen en tus dispositivos).

## Avisos con la app cerrada (sprint 2)

*Ajustes → Recordatorios → Activar*. Web Push con VAPID: el dispositivo sube su calendario de avisos de los próximos 30 días y el servidor los envía cada minuto. En iPhone hace falta iOS 16.4+ y abrir Scheura desde la pantalla de inicio. Opción para no enviar los títulos de las tareas al servidor.

## Servidor

`server/` — Cloudflare Worker (plan gratuito) con D1 y Cron Trigger cada minuto: `https://scheura-api.markel-alvarado.workers.dev`. Instrucciones de despliegue en [server/README.md](server/README.md). La app lo usa si se compila con `VITE_API_URL` (variable del repositorio en GitHub Actions).

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

## Limitaciones conocidas

- **Avisos:** en iPhone requieren iOS 16.4+ y la app añadida a la pantalla de inicio. El servidor envía como máximo 40 avisos por minuto (límite del plan gratuito).
- **PDFs:** la extracción de temas, fechas y conceptos usa heurísticas en el navegador; funciona con PDFs con texto (no escaneados).
- **Sincronización:** gana el último cambio según el reloj de cada dispositivo; los archivos de más de 25 MB no se sincronizan (sí sus datos extraídos).
