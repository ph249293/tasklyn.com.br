// ============================================================
// Tasklyn AI — Conexão com Supabase
// Preencha SUPABASE_URL e SUPABASE_ANON_KEY (Settings > API no Supabase)
// Nunca coloque a "service_role key" aqui — só a "anon public key".
// ============================================================

const SUPABASE_URL = "COLE_AQUI_A_PROJECT_URL";
const SUPABASE_ANON_KEY = "COLE_AQUI_A_ANON_PUBLIC_KEY";

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---------------- AUTENTICAÇÃO ----------------

async function signUp(email, password) {
  const { data, error } = await supabaseClient.auth.signUp({ email, password });
  if (error) throw error;
  return data;
}

async function signIn(email, password) {
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

async function signOut() {
  const { error } = await supabaseClient.auth.signOut();
  if (error) throw error;
}

async function getCurrentUser() {
  const { data: { user } } = await supabaseClient.auth.getUser();
  return user;
}

// ---------------- DOCUMENTOS ----------------

// Envia um arquivo para o Storage e cria o registro na tabela "documents"
async function uploadDocument(file, category = "Outros") {
  const user = await getCurrentUser();
  if (!user) throw new Error("Usuário não autenticado.");

  const filePath = `${user.id}/${Date.now()}_${file.name}`;

  const { error: uploadError } = await supabaseClient
    .storage
    .from("documents")
    .upload(filePath, file);
  if (uploadError) throw uploadError;

  const { data, error: insertError } = await supabaseClient
    .from("documents")
    .insert({
      user_id: user.id,
      name: file.name,
      file_path: filePath,
      file_type: file.type,
      category: category,
      status: "processing"
    })
    .select()
    .single();
  if (insertError) throw insertError;

  return data;
}

// Lista os documentos do usuário logado, mais recentes primeiro
async function listDocuments() {
  const { data, error } = await supabaseClient
    .from("documents")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

// Gera um link temporário para baixar/visualizar um arquivo
async function getDocumentUrl(filePath) {
  const { data, error } = await supabaseClient
    .storage
    .from("documents")
    .createSignedUrl(filePath, 60 * 10); // válido por 10 minutos
  if (error) throw error;
  return data.signedUrl;
}

// Apaga um documento (registro + arquivo)
async function deleteDocument(documentId, filePath) {
  const { error: storageError } = await supabaseClient
    .storage
    .from("documents")
    .remove([filePath]);
  if (storageError) throw storageError;

  const { error: dbError } = await supabaseClient
    .from("documents")
    .delete()
    .eq("id", documentId);
  if (dbError) throw dbError;
}

// ---------------- AUTOMAÇÕES ----------------

// Busca as automações do usuário logado como um objeto { chave: true/false }
async function getAutomations() {
  const user = await getCurrentUser();
  if (!user) throw new Error("Usuário não autenticado.");

  const { data, error } = await supabaseClient
    .from("automations")
    .select("key, enabled")
    .eq("user_id", user.id);
  if (error) throw error;

  const settings = {};
  (data || []).forEach(row => { settings[row.key] = row.enabled; });
  return settings;
}

// Liga/desliga uma automação específica (cria o registro se ainda não existir)
async function setAutomation(key, enabled) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Usuário não autenticado.");

  const { error } = await supabaseClient
    .from("automations")
    .upsert({ user_id: user.id, key, enabled }, { onConflict: "user_id,key" });
  if (error) throw error;
}
