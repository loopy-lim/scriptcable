import { Benchmarks } from './components/Benchmarks';
import { BeforeAfter } from './components/BeforeAfter';
import { Footer } from './components/Footer';
import { Hero } from './components/Hero';
import { HostMatrix } from './components/HostMatrix';
import { LinuxVerified } from './components/LinuxVerified';
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
        <BeforeAfter />
        <LinuxVerified />
      </main>
      <Footer />
    </>
  );
}
