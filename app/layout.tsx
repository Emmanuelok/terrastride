import type {Metadata} from 'next';
import './globals.css';
export const metadata:Metadata={title:'STRIDE Ghana — Built for more.',description:'Discover training equipment, activewear, sports nutrition, recovery and sport essentials. Build your routine with STRIDE Ghana.',icons:{icon:'/favicon.svg'}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en-GH"><body>{children}</body></html>}
