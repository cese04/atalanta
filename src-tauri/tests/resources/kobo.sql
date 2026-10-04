-- Base de datos con la forma de la de un Kobo (.kobo/KoboReader.sqlite), solo con las
-- columnas que usa FastRead.
--  - "Sísifo" (kepub): archivos a.html, b.html y c.html; capítulos que empiezan en a y en c.
--    El subrayado de b.html pertenece al capítulo que empezó en a (como en El mito de Sísifo).
--  - "Viejo" (epub sin archivos de tipo 9): el capítulo se encuentra por el ContentID.
-- Tipos de `content`: 6 = libro, 9 = archivo interno del libro, 899 = capítulo.

CREATE TABLE content (ContentID TEXT, ContentType INTEGER, Title TEXT, Attribution TEXT, VolumeIndex INTEGER, BookID TEXT);
CREATE TABLE Bookmark (VolumeID TEXT, ContentID TEXT, Text TEXT, Annotation TEXT, ChapterProgress REAL);

INSERT INTO content VALUES
  ('s', 6, 'Sísifo', 'Camus', -1, NULL),
  ('s!!a.html', 9, NULL, NULL, 0, 's'), ('s!!b.html', 9, NULL, NULL, 1, 's'), ('s!!c.html', 9, NULL, NULL, 2, 's'),
  ('s!!a.html-1', 899, 'Uno', NULL, 0, 's'), ('s!!c.html-1', 899, 'Tres', NULL, 1, 's'),
  ('v', 6, 'Viejo', 'Anónimo', -1, NULL),
  ('v#(1)cap1.html', 899, 'Primero', NULL, 0, 'v');

INSERT INTO Bookmark VALUES
  ('s', 's!!c.html', 'En el tres.', NULL, 0.1),
  ('s', 's!!b.html', '  En el dos.  ', 'Comentario', 0.5),   -- espacios: se recortan
  ('s', 's!!a.html', 'En el uno.', NULL, 0.2),
  ('s', 's!!a.html', NULL, NULL, 0.9),                       -- marcador sin texto: se ignora
  ('s', 's!!a.html', NULL, 'Solo una nota', 0.95),           -- nota sin texto: se conserva
  ('v', 'v#(1)cap1.html', 'Del viejo.', NULL, 0.3);
