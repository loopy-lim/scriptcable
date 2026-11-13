import { Benchmarks } from './components/Benchmarks';
import { Footer } from './components/Footer';
import { Hero } from './components/Hero';
import { HostMatrix } from './components/HostMatrix';
import { LiveDemo } from './components/LiveDemo';
import { Nav } from './components/Nav';

export default function App() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <LiveDemo />
        <HostMatrix />
        <Benchmarks />
      </main>
      <Footer />
    </>
  );
}
