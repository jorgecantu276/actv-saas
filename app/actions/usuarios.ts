'use server'

import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function crearAccesoUsuario(formData: any) {
  try {
    // 1. Creamos el usuario en Supabase Auth con metadata para el Trigger
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: formData.email,
      password: formData.password,
      email_confirm: true,
      user_metadata: { 
        rol: formData.rol, // Ej: "PDV ACTV", "moderador", "admin"
        nombre_completo: formData.nombre_completo,
        telefono: formData.telefono // Opcional: también puedes incluir teléfono
      }
    });

    if (authError) throw new Error(authError.message);

    // 2. Usamos UPSERT para evitar chocar con perfiles ya creados automáticamente
    const { error: profileError } = await supabaseAdmin
      .from('perfiles')
      .upsert([{
        id: authData.user.id,
        email: formData.email,
        nombre_completo: formData.nombre_completo,
        telefono: formData.telefono,
        rol: formData.rol,
        eventos_asignados: (formData.rol?.toLowerCase() === 'moderador' || formData.rol?.toLowerCase() === 'cajero') ? formData.eventos_asignados : []
      }]);

    if (profileError) throw new Error(profileError.message);

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function actualizarContrasenaUsuario(uid: string, nuevaContrasena: string) {
  try {
    // Usamos el supabaseAdmin que ya importaste arriba para tener permisos de administrador absolutos
    const { data, error } = await supabaseAdmin.auth.admin.updateUserById(uid, {
      password: nuevaContrasena
    });

    if (error) throw error;
    
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}