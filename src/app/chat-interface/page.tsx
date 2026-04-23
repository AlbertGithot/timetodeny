import { Suspense } from 'react';
import ChatInterfaceClient from './components/ChatInterfaceClient';

export default function ChatInterfacePage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-screen bg-gray-950 text-white">Loading...</div>}>
      <ChatInterfaceClient />
    </Suspense>
  );
}