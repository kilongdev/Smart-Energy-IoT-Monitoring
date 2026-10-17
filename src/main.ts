import 'reflect-metadata';

import { createApp } from './app';

createApp()
  .then((app) =>
    app.listen(
      Number(process.env.PORT || 3000),
      '0.0.0.0',
    ),
  )
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });