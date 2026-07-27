"use client";

import Logo from "./logo";
import GetExtensionButton from "./get-extension-button";

export default function Header() {
  return (
    <div className="relative z-50 w-full">
      <div className="w-full px-8 py-5 absolute">
        <div className="flex flex-row items-center justify-between w-full">
          <div className="flex flex-row items-center gap-3">
            <Logo className="h-4 w-auto md:h-5" />
            <h1 className="text-base md:text-xl self-center p-0 font-medium">JustClarify</h1>
          </div>
          <GetExtensionButton
            onClick={() =>
              window.open(
                "https://chromewebstore.google.com/detail/justclarify/ggeikfbifbojgkgcehebpelplhajfffj",
                "_blank"
              )
            }
            className="w-[118px] md:w-[133px] ml-2"
          />
        </div>
      </div>
    </div>
  );
}

