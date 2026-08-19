# Dados del Mentiroso — v2 (independiente, desplegable en Vercel)

Esta es la versión que vive en tu propio dominio, separada de la que corre
como artefacto dentro de Claude (esa queda como respaldo). Usa **Upstash
Redis** en vez de `window.storage` para el almacenamiento compartido entre
jugadores — es un almacén clave-valor simple, sin tablas ni reglas que
configurar.

## 1. Crear el backend gratuito (Upstash Redis)

1. Ve a https://console.upstash.com y crea una cuenta gratis (puedes
   entrar con GitHub o Google).
2. Botón **"Create Database"**. Ponle un nombre (ej. `dados-mentiroso`),
   elige el tipo **Regional** (no Global, no lo necesitas), y cualquier
   región cercana. Plan gratuito por defecto.
3. Entra a la base de datos recién creada y busca la pestaña **"REST API"**.
   Ahí verás dos valores:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`

   Eso es todo — no hay tablas que crear ni reglas de seguridad que
   escribir.

## 2. Configurar el proyecto localmente

```bash
cd dados-v2
npm install
cp .env.example .env.local
```

Abre `.env.local` y pega los dos valores del paso anterior:

```
VITE_UPSTASH_REDIS_REST_URL=https://xxxxx.upstash.io
VITE_UPSTASH_REDIS_REST_TOKEN=el_token_largo_que_te_dio_upstash
```

Prueba local:

```bash
npm run dev
```

Abre la URL que muestra la terminal (normalmente `http://localhost:5173`).
Si quieres probarlo desde tu celular en la misma red WiFi, usa
`npm run dev -- --host` y entra desde el celular a la IP que te muestre.

## 3. Desplegar en Vercel

Opción CLI (más directa):

```bash
npm install -g vercel
vercel
```

Sigue las preguntas (crea cuenta gratis si no tienes). Cuando pregunte por
variables de entorno, o después desde el dashboard de Vercel
(**Settings > Environment Variables**), agrega las mismas dos variables
`VITE_UPSTASH_REDIS_REST_URL` y `VITE_UPSTASH_REDIS_REST_TOKEN` de tu
`.env.local`.

Luego:

```bash
vercel --prod
```

Vercel te da una URL del tipo `dados-del-mentiroso-v2.vercel.app` (o el
nombre que elijas) — esa es la que compartes con tus jugadores.

Opción sin CLI: sube esta carpeta a un repositorio de GitHub, entra a
https://vercel.com/new, importa el repositorio, agrega las mismas dos
variables de entorno en la pantalla de configuración, y despliega.

## 4. Uso

Idéntico a la versión de Claude: cada jugador abre la URL, elige nombre y
mesa (6 mesas, 3 jugadores cada una), y juega. El botón **"Datos"** en la
esquina superior lleva al panel de investigador, donde **"Descargar CSV"**
funciona como una descarga de archivo normal.

## Nota de seguridad

El token de Upstash queda embebido en el código que corre en el navegador
de cada jugador (así funciona cualquier app que llama una API solo desde
el frontend, sin backend propio) — cualquiera que inspeccione el código de
la página podría ver ese token y usarlo para leer o escribir en tu base de
datos. Para una sesión puntual con gente de confianza es un riesgo
aceptable, igual que las reglas abiertas de Firebase que mencionamos antes.
Si quieres cerrarlo del todo, la alternativa es meter las llamadas a
Upstash detrás de una función serverless (por ejemplo, una API route de
Vercel) que guarde el token solo del lado del servidor — pero eso ya es un
paso más de trabajo que no hace falta para esto.
