// Ubicación: app/loading.tsx (o dentro de la carpeta donde tengas el page.tsx principal)
import React from 'react';

export default function Loading() {
  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center bg-[#F1F3F9] z-50">
      {/* Contenedor del Logo con fondo sutil */}
      <div className="bg-white/60 p-6 rounded-full shadow-lg border border-gray-100 mb-8 backdrop-blur-sm">
        {/* Usamos el SVG de tu logo para que sea nítido */}
        <svg 
          width="80" 
          height="80" 
          viewBox="0 0 160 160" 
          fill="none" 
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Fondo del Logo (Círculo Negro) */}
          <circle cx="80" cy="80" r="80" fill="black"/>
          
          {/* Texto "ACTV" (ajustado de tu logo original) */}
          <path d="M40 95.8V64.2H47.4L55.8 86.8L64.2 64.2H71.6V95.8H65V70.6L57.2 92.4H54.4L46.6 70.6V95.8H40Z" fill="white"/>
          <path d="M85 95.8L73.6 64.2H80.6L88.2 86.8L95.8 64.2H102.8L91.4 95.8H85Z" fill="white"/>
          <path d="M120 95.8V64.2H126.6V95.8H120Z" fill="white"/>
        </svg>
      </div>

      {/* Spinner y Texto */}
      <div className="text-center flex flex-col items-center">
        {/* Spinner animado con los colores de tu marca (Azul fuerte) */}
        <div className="animate-spin rounded-full h-12 w-12 border-t-4 border-b-4 border-blue-700 mb-4"></div>
        
        {/* Mensaje principal */}
        <h2 className="text-3xl font-bold text-gray-800 tracking-tight">Cargando ACTV SaaS</h2>
        
        {/* Mensaje secundario y de progreso */}
        <p className="text-lg text-gray-600 mt-2 max-w-sm">
          Un momento por favor. Estamos preparando tu panel de control y sincronizando la información más reciente de la carrera.
        </p>
      </div>
    </div>
  );
}