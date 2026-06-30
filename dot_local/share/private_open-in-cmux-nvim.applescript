-- Open files in Neovim inside cmux
-- Usage: Set the compiled .app as macOS default editor via Finder > Get Info > Open With

property cmux : "/Applications/cmux.app/Contents/Resources/bin/cmux"

on open theFiles
	set filePaths to {}
	repeat with f in theFiles
		set end of filePaths to quoted form of POSIX path of f
	end repeat

	set fileArgs to joinList(filePaths, " ")
	set cwd to extractDirectory(POSIX path of (item 1 of theFiles))

	do shell script cmux & " new-workspace" & ¬
		" --name 'nvim'" & ¬
		" --cwd " & quoted form of cwd & ¬
		" --focus true" & ¬
		" --command 'nvim " & fileArgs & "'"

	tell application "cmux" to activate
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
	set result to theList as text
	set AppleScript's text item delimiters to tid
	return result
end joinList
