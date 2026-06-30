-- Open files in Neovim inside cmux
-- Uses AppleScript Apple Events (no socket required)

on open theFiles
	set filePaths to {}
	repeat with f in theFiles
		set end of filePaths to quoted form of POSIX path of f
	end repeat

	set fileArgs to joinList(filePaths, " ")
	set cwd to extractDirectory(POSIX path of (item 1 of theFiles))

	tell application "cmux"
		set newTab to new tab
		set t to focused terminal of newTab
		input text "cd " & quoted form of cwd & " && nvim " & fileArgs & return to t
		activate
	end tell
end open

on run
	tell application "cmux" to activate
end run

on extractDirectory(posixPath)
	set tid to AppleScript's text item delimiters
	set AppleScript's text item delimiters to "/"
	set parts to text items of posixPath
	if (count of parts) > 1 then
		set parts to items 1 thru -2 of parts
	end if
	set dir to parts as text
	set AppleScript's text item delimiters to tid
	return dir
end extractDirectory

on joinList(theList, delimiter)
	set tid to AppleScript's text item delimiters
	set AppleScript's text item delimiters to delimiter
	set joined to theList as text
	set AppleScript's text item delimiters to tid
	return joined
end joinList
