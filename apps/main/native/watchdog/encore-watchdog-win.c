#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <shellapi.h>
#include <tlhelp32.h>

#include <stdlib.h>
#include <string.h>
#include <wchar.h>

enum scan_result {
   SCAN_RETRY = -1,
   SCAN_NOT_FOUND = 0,
   SCAN_FOUND = 1
};

struct close_windows_context {
   DWORD process_id;
};

static enum scan_result scan_processes(const wchar_t *process_name) {
   HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
   if (snapshot == INVALID_HANDLE_VALUE) return SCAN_RETRY;

   PROCESSENTRY32W process = {0};
   process.dwSize = sizeof(process);
   if (!Process32FirstW(snapshot, &process)) {
      CloseHandle(snapshot);
      return SCAN_RETRY;
   }

   do {
      if (_wcsicmp(process.szExeFile, process_name) != 0) continue;
      CloseHandle(snapshot);
      return SCAN_FOUND;
   } while (Process32NextW(snapshot, &process));

   CloseHandle(snapshot);
   return SCAN_NOT_FOUND;
}

static BOOL CALLBACK close_process_window(HWND window, LPARAM parameter) {
   struct close_windows_context *context = (struct close_windows_context *)parameter;
   DWORD process_id = 0;
   GetWindowThreadProcessId(window, &process_id);

   if (process_id == context->process_id) PostMessageW(window, WM_CLOSE, 0, 0);
   return TRUE;
}

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE previous_instance, PWSTR command_line, int show_command) {
   (void)instance;
   (void)previous_instance;
   (void)command_line;
   (void)show_command;

   int argument_count = 0;
   wchar_t **arguments = CommandLineToArgvW(GetCommandLineW(), &argument_count);
   if (arguments == NULL) return 2;

   if (argument_count != 5 || wcscmp(arguments[1], L"--parent") != 0) {
      LocalFree(arguments);
      return 2;
   }

   wchar_t *end = NULL;
   unsigned long parsed_process_id = wcstoul(arguments[2], &end, 10);
   if (end == arguments[2] || *end != L'\0' || parsed_process_id == 0) {
      LocalFree(arguments);
      return 2;
   }

   DWORD parent_process_id = (DWORD)parsed_process_id;
   const wchar_t *game_process_name = arguments[3];
   const wchar_t *relaunch_path = arguments[4];
   int found = 0;

   for (int attempt = 0; attempt < 300; attempt++) {
      Sleep(1000);

      HANDLE parent = OpenProcess(SYNCHRONIZE, FALSE, parent_process_id);
      int parent_running = parent == NULL ? GetLastError() == ERROR_ACCESS_DENIED : WaitForSingleObject(parent, 0) == WAIT_TIMEOUT;
      if (parent != NULL) CloseHandle(parent);
      if (!parent_running) break;

      if (scan_processes(game_process_name) == SCAN_FOUND) {
         found = 1;
         break;
      }
   }

   if (!found) {
      LocalFree(arguments);
      return 0;
   }

   HANDLE parent = OpenProcess(SYNCHRONIZE | PROCESS_TERMINATE, FALSE, parent_process_id);
   if (parent == NULL) {
      LocalFree(arguments);
      return 3;
   }

   struct close_windows_context context = {parent_process_id};
   EnumWindows(close_process_window, (LPARAM)&context);

   if (WaitForSingleObject(parent, 5000) == WAIT_TIMEOUT) {
      if (!TerminateProcess(parent, 0)) {
         CloseHandle(parent);
         LocalFree(arguments);
         return 3;
      }
      WaitForSingleObject(parent, 5000);
   }

   int closed = WaitForSingleObject(parent, 0) == WAIT_OBJECT_0;
   CloseHandle(parent);
   if (!closed) {
      LocalFree(arguments);
      return 3;
   }

   int absent_scans = 0;
   while (absent_scans < 2) {
      Sleep(1000);
      enum scan_result result = scan_processes(game_process_name);
      if (result == SCAN_FOUND) absent_scans = 0;
      else if (result == SCAN_NOT_FOUND) absent_scans++;
   }

   size_t path_length = wcslen(relaunch_path);
   wchar_t *relaunch_command = (wchar_t *)calloc(path_length + 3, sizeof(wchar_t));
   if (relaunch_command == NULL) {
      LocalFree(arguments);
      return 4;
   }

   relaunch_command[0] = L'"';
   memcpy(relaunch_command + 1, relaunch_path, (path_length + 1) * sizeof(wchar_t));
   relaunch_command[path_length + 1] = L'"';

   STARTUPINFOW startup = {0};
   startup.cb = sizeof(startup);
   PROCESS_INFORMATION relaunched_process = {0};
   int relaunched = CreateProcessW(relaunch_path, relaunch_command, NULL, NULL, FALSE, CREATE_NEW_PROCESS_GROUP, NULL, NULL, &startup, &relaunched_process);

   free(relaunch_command);
   if (relaunched) {
      CloseHandle(relaunched_process.hThread);
      CloseHandle(relaunched_process.hProcess);
   }

   LocalFree(arguments);
   return relaunched ? 0 : 4;
}
