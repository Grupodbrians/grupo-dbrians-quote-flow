# Quote Flow — Grupo D'Brians

App de cotizaciones (React + Vite) con login, historial compartido,
numeración consecutiva, panel de administrador y auditoría — sobre
Supabase, desplegada en Vercel.

**Esta guía asume que vas a empezar el despliegue desde cero**, para
eliminar cualquier configuración vieja de Vercel que haya quedado mal
(fue la causa de la pantalla en blanco que tuviste). No se quita ninguna
funcionalidad — todo lo agregado (login, historial compartido, usuarios,
auditoría, PDF, WhatsApp, membrete) sigue igual.

## Qué incluye

- Login obligatorio (correo + contraseña) vía Supabase Auth.
- Historial compartido entre todo el equipo, numeración consecutiva real
  (`COT-20260818-0001`, `0002`, ...), generada de forma atómica.
- Descargar PDF de cualquier cotización desde el historial.
- Panel de administrador: crear usuarios, desactivarlos o eliminarlos
  (nunca al administrador).
- Auditoría: quién hizo qué y cuándo.
- Marca "Desarrollado por Grupo D'Brians SRL" fija en la interfaz y en el
  login.
- Motor de cálculo, PDF, WhatsApp y membrete: intactos.
- `vercel.json` nuevo: le dice a Vercel exactamente cómo construir el
  proyecto (framework Vite, `npm run build`, carpeta `dist`), para que no
  dependa de que el panel esté bien configurado a mano.

## 1. Requisitos

- Node.js 18+, cuenta de GitHub, cuenta de Vercel, cuenta de Supabase
  (gratis), API key de Anthropic (console.anthropic.com).

## 2. Empezar limpio en GitHub

Para no arrastrar nada de intentos anteriores, crea un **repositorio
nuevo y vacío** en https://github.com/new (por ejemplo
`grupo-dbrians/quote-flow`). No lo inicialices con README.

En tu computadora, en una carpeta nueva y vacía:

```bash
# descomprime este zip aquí, y dentro de la carpeta quote-flow:
cd quote-flow
git init
git add .
git commit -m "Quote Flow — despliegue limpio"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/quote-flow.git
git push -u origin main
```

Si ya tenías un repo de intentos anteriores, es más simple **borrarlo y
crear uno nuevo** con este nombre, que "limpiarlo" archivo por archivo.

## 3. Empezar limpio en Vercel

**Elimina el proyecto de Vercel que te está dando problemas**
(Settings → General → baja hasta el final → "Delete Project"), o si
prefieres no borrarlo, simplemente no lo reutilices.

1. En Vercel → "Add New" → "Project" → importa el repositorio nuevo que
   acabas de crear.
2. Vercel debería detectar "Vite" automáticamente (y con `vercel.json`
   incluido, queda forzado aunque la detección falle). **No** toques
   "Root Directory" — déjalo vacío, tal como aparece por defecto.
3. Antes de darle "Deploy", abre "Environment Variables" en esa misma
   pantalla y agrega las 5 (ver paso 5 más abajo) — o agrégalas después
   en Settings y haz un redeploy.
4. Deploy.

## 4. Crear el proyecto en Supabase (si no lo has hecho aún)

1. https://supabase.com/dashboard → New Project.
2. **SQL Editor → New query** → pega todo `supabase/schema.sql` → Run.
   (Es seguro volver a correrlo aunque ya lo hayas hecho antes.)
3. **Settings → API**: copia `Project URL`, `anon public key` y
   `service_role key`.
4. **Authentication → Users → Add user**: crea tu correo/contraseña de
   administrador. Copia el **User UID**.
5. **SQL Editor**, corre (con tus datos reales):
   ```sql
   insert into public.perfiles (id, email, rol, activo)
   values ('PEGA-AQUI-EL-UID', 'tu-correo@grupodbrians.com', 'admin', true)
   on conflict (id) do update set rol = 'admin', activo = true;
   ```

## 5. Variables de entorno en Vercel

Settings → Environment Variables → agrega estas 5, marcadas para
**Production** (y Preview si quieres probar ramas):

| Variable | Valor |
|---|---|
| `VITE_SUPABASE_URL` | tu Project URL de Supabase |
| `VITE_SUPABASE_ANON_KEY` | tu anon public key |
| `SUPABASE_URL` | la misma Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | tu service role key (secreta) |
| `ANTHROPIC_API_KEY` | tu API key de console.anthropic.com |

Después de guardarlas: **Deployments → el de arriba → ⋯ → Redeploy**
(sin caché). Las variables `VITE_*` solo quedan incrustadas en un build
que corre *después* de haberlas guardado.

## 6. Reconectar tu subdominio

En el proyecto nuevo de Vercel → Settings → Domains → agrega
`cotizador.grupodbrians.com` (o el que uses). Si el registro CNAME ya
existe apuntando a Vercel de un intento anterior, no hace falta tocar el
DNS de nuevo — solo agregar el dominio aquí y Vercel lo reconoce.

## 7. Verificar

Abre el subdominio en una ventana de incógnito. Deberías ver la pantalla
de login (logo + formulario), no una página en blanco. Entra con tu
correo de administrador y ya puedes crear al resto del equipo desde
"Usuarios".

## 8. Si algo vuelve a fallar

Antes de nada, revisa en Vercel → Deployments → el deployment más
reciente → pestaña "Building" (logs del build). Si dice algo como
`vite build` seguido de `dist/index.html` y `dist/assets/...`, el build
fue correcto. Si ves un error ahí, ese es el punto exacto a corregir —
compártemelo tal cual.

## 9. Seguridad

- Las contraseñas las guarda y protege Supabase Auth.
- `SUPABASE_SERVICE_ROLE_KEY` solo se usa dentro de
  `api/admin-crear-usuario.js` y `api/admin-gestionar-usuario.js`
  (funciones de servidor), nunca en el navegador.
- RLS activo en las tres tablas; crear/desactivar/eliminar usuarios se
  valida también en el servidor, no solo en la interfaz.
- El administrador no puede desactivarse ni eliminarse.
- `.env` y `.env.local` están en `.gitignore`.
