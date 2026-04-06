Install dependencies from repository root:

```sh
npm install
```

Required environment variables:

```sh
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/whatsapp_bot
PORT=3000
BETTER_AUTH_SECRET=change-me
BETTER_AUTH_URL=http://localhost:3000
```

Run migrations (after generating or with `db:push`):

```sh
npm run db:push
```

Run Bun-native development server:

```sh
npm run dev
```

Start server:

```sh
npm run start
```
