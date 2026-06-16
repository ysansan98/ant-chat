import Download from './components/Download'
import Features from './components/Features'
import Footer from './components/Footer'
import Header from './components/Header'
import Hero from './components/Hero'
import LoadingScreen from './components/LoadingScreen'
import TechStack from './components/TechStack'

export default function App() {
  return (
    <div className="min-h-screen">
      <LoadingScreen />
      <Header />
      <main>
        <Hero />
        <Features />
        <TechStack />
        <Download />
      </main>
      <Footer />
    </div>
  )
}
