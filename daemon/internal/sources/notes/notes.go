package notes

import (
	"bytes"
	"compress/gzip"
	"context"
	"database/sql"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	_ "github.com/mattn/go-sqlite3"

	"pkb-daemon/internal/config"
)

type Source struct {
	dbPath string
}

// NoteImport represents a note to be imported
type NoteImport struct {
	SourceID  string
	Title     string
	Content   string
	Folder    string
	UpdatedAt time.Time
	CreatedAt time.Time
}

func New(cfg config.NotesConfig) (*Source, error) {
	dbPath := cfg.DBPath
	if dbPath == "" {
		home, _ := os.UserHomeDir()
		dbPath = filepath.Join(home, "Library/Group Containers/group.com.apple.notes/NoteStore.sqlite")
	}

	return &Source{
		dbPath: expandPath(dbPath),
	}, nil
}

func (s *Source) Name() string {
	return "notes"
}

// Sync fetches notes from the Apple Notes database
// Notes are imported as notes, not communications
// They can be used for contact enrichment via LLM processing later
func (s *Source) Sync(ctx context.Context, checkpoint string, limit int) ([]NoteImport, string, error) {
	db, err := sql.Open("sqlite3", s.dbPath+"?mode=ro")
	if err != nil {
		return nil, checkpoint, fmt.Errorf("failed to open Notes database: %w", err)
	}
	defer db.Close()

	var lastRowID int64 = 0
	if checkpoint != "" {
		lastRowID, _ = strconv.ParseInt(checkpoint, 10, 64)
	}

	// Query notes - ZICCLOUDSYNCINGOBJECT contains notes metadata
	// ZICNOTEDATA contains the actual note content
	query := `
		SELECT
			n.Z_PK,
			n.ZTITLE1,
			nd.ZDATA,
			n.ZMODIFICATIONDATE1,
			n.ZCREATIONDATE1,
			f.ZTITLE2 as folder_name
		FROM ZICCLOUDSYNCINGOBJECT n
		LEFT JOIN ZICNOTEDATA nd ON nd.ZNOTE = n.Z_PK
		LEFT JOIN ZICCLOUDSYNCINGOBJECT f ON n.ZFOLDER = f.Z_PK
		WHERE n.ZTYPEUTI1 = 'com.apple.notes.note'
		  AND n.Z_PK > ?
		  AND (n.ZMARKEDFORDELETION IS NULL OR n.ZMARKEDFORDELETION != 1)
		ORDER BY n.Z_PK ASC
		LIMIT ?
	`

	rows, err := db.QueryContext(ctx, query, lastRowID, limit)
	if err != nil {
		return nil, checkpoint, fmt.Errorf("failed to query notes: %w", err)
	}
	defer rows.Close()

	var notes []NoteImport
	newCheckpoint := checkpoint

	for rows.Next() {
		var pk int64
		var title sql.NullString
		var data []byte
		var modDate, createDate sql.NullFloat64
		var folder sql.NullString

		err := rows.Scan(&pk, &title, &data, &modDate, &createDate, &folder)
		if err != nil {
			continue
		}

		newCheckpoint = strconv.FormatInt(pk, 10)

		content := extractNoteContent(data)
		if content == "" && !title.Valid {
			continue
		}

		note := NoteImport{
			SourceID: fmt.Sprintf("note:%d", pk),
			Title:    title.String,
			Content:  content,
			Folder:   folder.String,
		}

		if modDate.Valid {
			note.UpdatedAt = coreDataTimestampToTime(modDate.Float64)
		}
		if createDate.Valid {
			note.CreatedAt = coreDataTimestampToTime(createDate.Float64)
		}

		notes = append(notes, note)
	}

	return notes, newCheckpoint, nil
}

// extractNoteContent extracts text content from Apple Notes data
// Apple Notes stores content as gzipped protobuf
// This is a simplified extraction that handles common cases
func extractNoteContent(data []byte) string {
	if len(data) == 0 {
		return ""
	}

	// Try to decompress if gzipped
	content := data
	if len(data) > 2 && data[0] == 0x1f && data[1] == 0x8b {
		reader, err := gzip.NewReader(bytes.NewReader(data))
		if err == nil {
			decompressed, err := io.ReadAll(reader)
			reader.Close()
			if err == nil {
				content = decompressed
			}
		}
	}

	// Apple Notes uses a protobuf format with embedded text
	// The text is typically stored as UTF-8 strings within the protobuf
	// We'll extract readable text by looking for string sequences
	return extractTextFromProtobuf(content)
}

// extractTextFromProtobuf extracts human-readable text from protobuf-encoded data
// This is a heuristic approach that looks for string fields in the protobuf
func extractTextFromProtobuf(data []byte) string {
	var result strings.Builder
	var currentString strings.Builder
	inString := false

	for i := 0; i < len(data); i++ {
		b := data[i]

		// Check if this could be a string field in protobuf
		// String fields are typically preceded by a length byte
		if !inString && i+1 < len(data) {
			length := int(b)
			// Check if this looks like a reasonable string length
			if length > 0 && length < 10000 && i+1+length <= len(data) {
				// Check if the following bytes look like UTF-8 text
				potentialString := data[i+1 : i+1+length]
				if isLikelyText(potentialString) {
					if result.Len() > 0 {
						result.WriteString("\n")
					}
					result.Write(potentialString)
					i += length
					continue
				}
			}
		}

		// Also collect runs of printable ASCII
		if b >= 32 && b < 127 {
			if !inString {
				inString = true
			}
			currentString.WriteByte(b)
		} else {
			if inString && currentString.Len() > 20 {
				// Only keep strings that are reasonably long
				if result.Len() > 0 {
					result.WriteString("\n")
				}
				result.WriteString(currentString.String())
			}
			currentString.Reset()
			inString = false
		}
	}

	// Don't forget the last string
	if inString && currentString.Len() > 20 {
		if result.Len() > 0 {
			result.WriteString("\n")
		}
		result.WriteString(currentString.String())
	}

	return strings.TrimSpace(result.String())
}

// isLikelyText checks if bytes look like human-readable text
func isLikelyText(data []byte) bool {
	if len(data) == 0 {
		return false
	}

	printableCount := 0
	for _, b := range data {
		// Allow printable ASCII, common Unicode ranges, and whitespace
		if (b >= 32 && b < 127) || b == '\n' || b == '\r' || b == '\t' || b >= 192 {
			printableCount++
		}
	}

	// At least 80% should be printable
	return float64(printableCount)/float64(len(data)) >= 0.8
}

func coreDataTimestampToTime(timestamp float64) time.Time {
	// Core Data timestamps are seconds since 2001-01-01
	coreDataEpoch := time.Date(2001, 1, 1, 0, 0, 0, 0, time.UTC)
	return coreDataEpoch.Add(time.Duration(timestamp * float64(time.Second)))
}

func expandPath(path string) string {
	if strings.HasPrefix(path, "~") {
		home, err := os.UserHomeDir()
		if err != nil {
			return path
		}
		return filepath.Join(home, path[1:])
	}
	return path
}
