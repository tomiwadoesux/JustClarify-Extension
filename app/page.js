import Image from "next/image";
import Hero from "@/components/hero";
import Veed from "@/components/veed";
import GoldenRatio from "@/components/golden-ratio";
import Jw from "@/components/jw";
import Abt from "@/components/abt";
import Why from "@/components/why";
import Header from "@/components/header";
// import Footer from "@/components/footer";
export default function Home() {
  return (
    <div className="relative">
      {/* <Hero /> */}
      <Header />
      <GoldenRatio />
      {/* <div className="py-5 relative">
        <div className="bg-black aspect-16/9 w-full h-70 relative"></div>
      </div> */}

      <div className="relative overflow-visible">
        <Veed />
        {/* <div className="absolute">
          <Jw />
        </div> */}
        <Abt />
        <Why />
      </div>

      {/* <Footer /> */}
      {/* </div> */}
    </div>
  );
}
