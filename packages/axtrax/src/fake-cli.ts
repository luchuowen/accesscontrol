import { demoSeed, FakeAxtrax } from './fake.js';

const fake = new FakeAxtrax(demoSeed());
fake
  .listen(Number(process.env.PORT ?? 8080))
  .then((u) => console.log(`fake AxTraxNG REST API on ${u} (user lango / lango)`));
