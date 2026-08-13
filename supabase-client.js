// ============================================================
// Tasklyn AI — Conexão com Supabase
// Preencha SUPABASE_URL e SUPABASE_ANON_KEY (Settings > API no Supabase)
// ============================================================

const SUPABASE_URL = "COLE_AQUI_A_PROJECT_URL";
const SUPABASE_ANON_KEY = "COLE_AQUI_A_ANON_PUBLIC_KEY";

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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

async function uploadDocument(file, category = "Outros") {
  const user = await getCurrentUser();
  if (!user) throw new Error("Usuário não autenticado.");

  const filePath = `${user.id}/${Date.now()}_${file.name}`;

  const { error: uploadError } = await supabaseClient
    .storage.from("documents").upload(filePath, file);
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
    .select().single();
  if (insertError) throw insertError;
  return data;
}

async function listDocuments() {
  const { data, error } = await supabaseClient
    .from("documents").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

async function getDocumentUrl(filePath) {
  const { data, error } = await supabaseClient
    .storage.from("documents").createSignedUrl(filePath, 600);
  if (error) throw error;
  return data.signedUrl;
}

async function deleteDocument(documentId, filePath) {
  const { error: storageError } = await supabaseClient
    .storage.from("documents").remove([filePath]);
  if (storageError) throw storageError;

  const { error: dbError } = await supabaseClient
    .from("documents").delete().eq("id", documentId);
  if (dbError) throw dbError;
}
